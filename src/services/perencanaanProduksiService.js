const pool = require("../config/database");
const { format } = require("date-fns");

// --- HELPER: Generate Nomor SPK Baru ---
const generateSpkNumber = async (connection, tanggal) => {
  const date = new Date(tanggal);
  const prefix = `SM-KO-${format(date, "MMyy")}`; // Format: SM-KO-MMYY
  const query = `
    SELECT IFNULL(MAX(RIGHT(spk_nomor, 4)), 0) + 1 AS next_num
    FROM kencanaprint.tspk 
    WHERE spk_nomor LIKE ?;
  `;
  const [rows] = await connection.query(query, [`${prefix}%`]);
  const nextNumber = rows[0].next_num.toString().padStart(4, "0");
  return `${prefix}${nextNumber}`;
};

const getPriorityData = async (filters) => {
  const { kategori, keyword, page = 1, itemsPerPage = 50 } = filters;
  const connection = await pool.getConnection();

  try {
    let filterParams = [];
    let searchFilter = "";
    let kategoriFilter = "";

    if (kategori && kategori !== "Semua") {
      kategoriFilter = " AND a.brg_ktgp = ? ";
      filterParams.push(kategori);
    }

    if (keyword && keyword.trim() !== "") {
      const searchTerm = `%${keyword.trim()}%`;
      searchFilter = ` AND (b.brgd_kode LIKE ? OR TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna)) LIKE ?)`;
      filterParams.push(searchTerm, searchTerm);
    }

    // 1. QUERY INTI: Menggunakan Derived Tables agar agregasi hanya diproses 1x
    const baseQuery = `
      FROM tbarangdc a
      JOIN tbarangdc_dtl b ON a.brg_kode = b.brgd_kode
      
      -- Agregasi Stok DC
      LEFT JOIN (
          SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in - mst_stok_out) AS stok_dc
          FROM tmasterstok 
          WHERE mst_cab = 'KDC' AND mst_aktif = 'Y'
          GROUP BY mst_brg_kode, mst_ukuran
      ) dc ON dc.mst_brg_kode = b.brgd_kode AND dc.mst_ukuran = b.brgd_ukuran

      -- Agregasi SPK Beredar
      LEFT JOIN (
          SELECT sub.kode, sub.ukuran, SUM(sub.qty_sisa) AS spk_beredar
          FROM (
              SELECT spkd.spkd_kode AS kode, spkd.spkd_ukuran AS ukuran, (spkd.spkd_qtyorder - IFNULL(SUM(stb.stbjd_jumlah), 0)) AS qty_sisa
              FROM kencanaprint.tspk_dc spkd
              JOIN kencanaprint.tspk spk ON spk.spk_nomor = spkd.spkd_nomor
              LEFT JOIN kencanaprint.tstbj_dtl stb ON stb.stbjd_spk_nomor = spkd.spkd_nomor AND stb.stbjd_size = spkd.spkd_ukuran
              WHERE spk.spk_aktif = 'Y' AND spk.spk_close = 0 AND YEAR(spk.spk_tanggal) >= 2026 AND spk.user_create IN ('ADIN', 'LUTFI')
              GROUP BY spkd.spkd_nomor, spkd.spkd_kode, spkd.spkd_ukuran
              HAVING qty_sisa > 0
          ) sub
          GROUP BY sub.kode, sub.ukuran
      ) spk ON spk.kode = b.brgd_kode AND spk.ukuran = b.brgd_ukuran

      -- Agregasi Toko (Buffer, Stok, Kekurangan per Toko diringkas ke level SKU)
      LEFT JOIN (
          SELECT 
              b2.brgd_kode, b2.brgd_ukuran,
              SUM(b2.brgd_min) AS total_buffer_store,
              SUM(IFNULL(mst.stok_aktual, 0)) AS total_stok_store,
              SUM(GREATEST(0, b2.brgd_min - IFNULL(mst.stok_aktual, 0))) AS total_kekurangan_store
          FROM tbarangdc_dtl2 b2
          LEFT JOIN (
              SELECT mst_cab, mst_brg_kode, mst_ukuran, SUM(mst_stok_in - mst_stok_out) AS stok_aktual
              FROM tmasterstok 
              WHERE mst_aktif = 'Y' AND mst_cab != 'KDC'
              GROUP BY mst_cab, mst_brg_kode, mst_ukuran
          ) mst ON mst.mst_cab = b2.brgd_cab AND mst.mst_brg_kode = b2.brgd_kode AND mst.mst_ukuran = b2.brgd_ukuran
          GROUP BY b2.brgd_kode, b2.brgd_ukuran
      ) store ON store.brgd_kode = b.brgd_kode AND store.brgd_ukuran = b.brgd_ukuran

      WHERE a.brg_aktif = 0 
        AND a.brg_logstok = 'Y' 
        AND UPPER(a.brg_warna) NOT LIKE '%STICKER%'
        AND UPPER(a.brg_warna) NOT LIKE '%EMBLEM%'
        AND b.brgd_ukuran NOT IN ('ALLSIZE', 'XS', '4XL', '5XL', '6XL', '7XL', '8XL', '9XL', '10XL', 'OVERSIZE', 'JUMBO')
        ${kategoriFilter}
        ${searchFilter}
    `;

    // 2. PEMBUNGKUS KALKULASI: Agar bisa di-sort by Gap DC secara langsung
    const wrapperQuery = `
      SELECT 
        *,
        GREATEST(0, buffer_dc - (stok_dc + spk_beredar)) AS gap_dc,
        ROUND((stok_dc + spk_beredar) / GREATEST(buffer_store / 30, 1)) AS coverage_dc
      FROM (
        SELECT 
          b.brgd_kode AS kode, b.brgd_ukuran AS ukuran,
          TRIM(CONCAT(a.brg_jeniskaos, ' ', a.brg_tipe, ' ', a.brg_lengan, ' ', a.brg_jeniskain, ' ', a.brg_warna)) AS nama,
          a.brg_ktgp AS kategori, b.brgd_hpp AS hpp,
          
          -- [BARU] Subquery untuk mengambil 1 gambar utama
          IFNULL((
            SELECT img_url 
            FROM tbarangdc_images 
            WHERE img_brg_kode = b.brgd_kode 
            ORDER BY img_index ASC LIMIT 1
          ), '') AS img_url,

          IFNULL(b.brgd_mindc, 0) AS buffer_dc,
          IFNULL(dc.stok_dc, 0) AS stok_dc,
          IFNULL(spk.spk_beredar, 0) AS spk_beredar,
          IFNULL(store.total_buffer_store, 0) AS buffer_store,
          IFNULL(store.total_stok_store, 0) AS stok_store,
          IFNULL(store.total_kekurangan_store, 0) AS kekurangan_store
        ${baseQuery}
      ) AS raw_data
    `;

    // 3. HITUNG SUMMARY KARTU ATAS (Dihitung dari total data tanpa limit)
    const summarySql = `
      SELECT 
        COUNT(*) AS total_items,
        SUM(stok_dc) AS total_stok_dc,
        SUM(CASE WHEN coverage_dc < 7 THEN 1 ELSE 0 END) AS sku_kritis,
        SUM(CASE WHEN coverage_dc >= 7 AND coverage_dc <= 15 THEN 1 ELSE 0 END) AS sku_perhatian,
        SUM(CASE WHEN coverage_dc > 15 THEN 1 ELSE 0 END) AS sku_aman
      FROM (${wrapperQuery}) AS summary_tbl
    `;
    const [summaryRows] = await connection.query(summarySql, filterParams);
    const summary = summaryRows[0];

    // 4. TERAPKAN PAGINATION (Hanya narik data yang dilihat layar)
    let dataParams = [...filterParams];
    let paginationSql = "";

    if (parseInt(itemsPerPage) > 0) {
      const limit = parseInt(itemsPerPage);
      const offset = (parseInt(page) - 1) * limit;
      paginationSql = " LIMIT ? OFFSET ? ";
      dataParams.push(limit, offset);
    }

    const totalStokDC = summary.total_stok_dc || 0;
    const KAPASITAS_HARIAN = 1750;
    const coverageProduksi = Math.round(totalStokDC / KAPASITAS_HARIAN);

    const dataSql = `
      ${wrapperQuery}
      ORDER BY gap_dc DESC, kekurangan_store DESC
      ${paginationSql}
    `;

    const [rows] = await connection.query(dataSql, dataParams);

    const items = rows.map((row, index) => {
      let status = "Aman";
      if (row.coverage_dc < 7) status = "Kritis";
      else if (row.coverage_dc <= 15) status = "Perlu Perhatian";

      return {
        ...row,
        status,
        rekomendasi_spk: row.gap_dc > 0 ? row.gap_dc : 0,
        // Kalkulasi index asli (meskipun di page 2, rank tetap lanjut)
        ranking_asli:
          (parseInt(page) > 0
            ? (parseInt(page) - 1) * parseInt(itemsPerPage)
            : 0) +
          index +
          1,
      };
    });

    return {
      data: items,
      summary: {
        totalItems: summary.total_items,
        totalStokDC: totalStokDC,
        coverageProduksi: coverageProduksi,
        kapasitasHarian: KAPASITAS_HARIAN,
        skuKritis: summary.sku_kritis || 0,
        skuPerhatian: summary.sku_perhatian || 0,
        skuAman: summary.sku_aman || 0,
      },
    };
  } finally {
    connection.release();
  }
};

const getStoreDetails = async (kode, ukuran) => {
  const query = `
    SELECT 
        g.gdg_nama AS cabang_nama,
        b2.brgd_min AS buffer,
        IFNULL(SUM(m.mst_stok_in - m.mst_stok_out), 0) AS stok_aktual,
        (b2.brgd_min - IFNULL(SUM(m.mst_stok_in - m.mst_stok_out), 0)) AS kekurangan
    FROM tgudang g
    JOIN tbarangdc_dtl2 b2 ON b2.brgd_cab = g.gdg_kode
    LEFT JOIN tmasterstok m ON m.mst_cab = g.gdg_kode AND m.mst_brg_kode = b2.brgd_kode AND m.mst_ukuran = b2.brgd_ukuran AND m.mst_aktif = 'Y'
    WHERE b2.brgd_kode = ? 
      AND b2.brgd_ukuran = ? 
      AND g.gdg_kode != 'KDC' -- HANYA FILTER INI
    GROUP BY g.gdg_kode, b2.brgd_min
    HAVING kekurangan > 0
    ORDER BY kekurangan DESC
  `;
  const [rows] = await pool.query(query, [kode, ukuran]);
  return rows;
};

const generateBulkSpk = async (items, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const today = format(new Date(), "yyyy-MM-dd");
    let generatedCount = 0;

    for (const item of items) {
      if (item.rekomendasi_spk <= 0) continue;

      const spkNomor = await generateSpkNumber(connection, today);
      const spkNama = item.nama; // Sesuai permintaan sebelumnya, bisa disesuaikan lagi

      // 1. Insert Header SPK
      await connection.query(
        `
        INSERT INTO kencanaprint.tspk 
        (spk_nomor, spk_tanggal, spk_dateline, spk_nama, spk_qty, spk_aktif, spk_close, user_create, date_create) 
        VALUES (?, ?, DATE_ADD(?, INTERVAL 14 DAY), ?, ?, 'Y', 0, ?, NOW())
      `,
        [spkNomor, today, today, spkNama, item.rekomendasi_spk, user.kode],
      );

      // 2. Insert Detail SPK
      await connection.query(
        `
        INSERT INTO kencanaprint.tspk_dc 
        (spkd_nomor, spkd_kode, spkd_ukuran, spkd_qtyorder) 
        VALUES (?, ?, ?, ?)
      `,
        [spkNomor, item.kode, item.ukuran, item.rekomendasi_spk],
      );

      generatedCount++;
    }

    await connection.commit();
    return {
      message: `Berhasil merilis ${generatedCount} SPK baru ke produksi.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  getPriorityData,
  getStoreDetails,
  generateBulkSpk,
};
