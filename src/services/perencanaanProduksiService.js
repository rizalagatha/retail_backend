const pool = require("../config/database");
const { format } = require("date-fns");

// --- Helper: generate nomor SPK format SPK PPIC: SPK-{perush}-{jo}-000001 ---
const generateSpkNomorPpic = async (connection, perushKode, joKode) => {
  const prefix = `SPK-${perushKode}-${joKode}-`;
  const [rows] = await connection.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(spk_nomor, ?, 6) AS UNSIGNED)), 0) AS jumlah
     FROM kencanaprint.tspk
     WHERE spk_perush_kode = ? AND spk_jo_kode = ? AND spk_nomor LIKE ?
     FOR UPDATE`,
    [prefix.length + 1, perushKode, joKode, `${prefix}%`],
  );
  const nextVal = rows[0].jumlah + 1;
  return `${prefix}${String(nextVal).padStart(6, "0")}`;
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

    // 1. QUERY INTI: Menggunakan Derived Tables
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

      -- Agregasi SPK WIP (Ready < 5 Hari)
      -- Fokus: SPK yang sudah memiliki entry di STBJ (Gudang Jadi/GP013)
      LEFT JOIN (
          SELECT sub.kode, sub.ukuran, SUM(sub.qty_wip) AS spk_ready
          FROM (
              SELECT 
                spkd.spkd_kode AS kode, 
                spkd.spkd_ukuran AS ukuran, 
                -- Hitung sisa order yang sudah masuk STBJ
                IFNULL(SUM(stb.stbjd_jumlah), 0) AS qty_wip
              FROM kencanaprint.tspk_dc spkd
              JOIN kencanaprint.tspk spk ON spk.spk_nomor = spkd.spkd_nomor
              
              -- Join ke STBJ untuk memastikan barang sudah sampai tahap ini
              JOIN kencanaprint.tstbj_dtl stb ON stb.stbjd_spk_nomor = spkd.spkd_nomor 
                                             AND stb.stbjd_size = spkd.spkd_ukuran
              JOIN kencanaprint.tstbj_hdr sth ON sth.stbj_nomor = stb.stbjd_stbj_nomor

              WHERE spk.spk_aktif = 'Y' AND spk.spk_close = 0 
                AND YEAR(spk.spk_tanggal) >= 2026 
                AND DATEDIFF(spk.spk_dateline, CURDATE()) <= 5
              GROUP BY spkd.spkd_nomor, spkd.spkd_kode, spkd.spkd_ukuran
              HAVING qty_wip > 0
          ) sub
          GROUP BY sub.kode, sub.ukuran
      ) spk ON spk.kode = b.brgd_kode AND spk.ukuran = b.brgd_ukuran

      -- Agregasi SPK Beredar (Aktif, belum masuk Jahit ke Lipat)
      LEFT JOIN (
          SELECT spkd.spkd_kode AS kode, spkd.spkd_ukuran AS ukuran,
                SUM(spkd.spkd_qtyorder) AS spk_beredar
          FROM kencanaprint.tspk_dc spkd
          JOIN kencanaprint.tspk spk ON spk.spk_nomor = spkd.spkd_nomor
          WHERE spk.spk_aktif = 'Y' 
            AND spk.spk_close = 0
            AND YEAR(spk.spk_tanggal) >= 2026
            -- Belum masuk STBJ sama sekali
            AND NOT EXISTS (
                SELECT 1 FROM kencanaprint.tstbj_dtl stb
                WHERE stb.stbjd_spk_nomor = spkd.spkd_nomor
                  AND stb.stbjd_size = spkd.spkd_ukuran
            )
          GROUP BY spkd.spkd_kode, spkd.spkd_ukuran
      ) beredar ON beredar.kode = b.brgd_kode AND beredar.ukuran = b.brgd_ukuran

      -- Agregasi Toko (Buffer, Stok, Gap Store)
      LEFT JOIN (
          SELECT 
              b2.brgd_kode, b2.brgd_ukuran,
              SUM(b2.brgd_min) AS total_buffer_store,
              SUM(IFNULL(mst.stok_aktual, 0)) AS total_stok_store,
              SUM(GREATEST(0, b2.brgd_min - IFNULL(mst.stok_aktual, 0))) AS gap_store
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

    // 2. PEMBUNGKUS KALKULASI UTAMA (Sesuai Rumus di Desain)
    const wrapperQuery = `
      SELECT 
        *,
        (stok_dc / daily_need) AS cvg_saat_ini,
        ((stok_dc + spk_ready) / daily_need) AS cvg_setelah_wip,
        GREATEST(0, (buffer_dc + gap_store) - (stok_dc + spk_ready)) AS gap_buffer_dc
      FROM (
        SELECT 
          b.brgd_kode AS kode, b.brgd_ukuran AS ukuran,
          TRIM(CONCAT(a.brg_jeniskaos, ' ', a.brg_tipe, ' ', a.brg_lengan, ' ', a.brg_jeniskain, ' ', a.brg_warna)) AS nama,
          a.brg_ktgp AS kategori, b.brgd_hpp AS hpp,
          
          IFNULL((
            SELECT img_url 
            FROM tbarangdc_images 
            WHERE img_brg_kode = b.brgd_kode 
            ORDER BY img_index ASC LIMIT 1
          ), '') AS img_url,

          IFNULL(b.brgd_mindc, 0) AS buffer_dc,
          IFNULL(dc.stok_dc, 0) AS stok_dc,
          IFNULL(spk.spk_ready, 0) AS spk_ready,
          IFNULL(store.total_buffer_store, 0) AS buffer_store,
          IFNULL(store.total_stok_store, 0) AS stok_store,
          IFNULL(store.gap_store, 0) AS gap_store,
          IFNULL(beredar.spk_beredar, 0) AS spk_beredar,
          
          -- Daily Need: Gap Store / 30. Minimal 1 agar tidak Error Divide By Zero
          GREATEST((IFNULL(store.gap_store, 0) / 30), 1) AS daily_need
        ${baseQuery}
      ) AS raw_data
    `;

    // 3. HITUNG SUMMARY KARTU ATAS
    const summarySql = `
      SELECT 
        COUNT(*) AS total_items,
        SUM(stok_dc) AS total_stok_dc,
        SUM(CASE WHEN cvg_setelah_wip < 7 THEN 1 ELSE 0 END) AS sku_kritis,
        SUM(CASE WHEN cvg_setelah_wip >= 7 AND cvg_setelah_wip <= 15 THEN 1 ELSE 0 END) AS sku_perhatian,
        SUM(CASE WHEN cvg_setelah_wip > 15 THEN 1 ELSE 0 END) AS sku_aman
      FROM (${wrapperQuery}) AS summary_tbl
    `;
    const [summaryRows] = await connection.query(summarySql, filterParams);
    const summary = summaryRows[0];

    // 4. TERAPKAN PAGINATION
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
      ORDER BY (buffer_dc > 0) DESC, cvg_setelah_wip ASC, gap_buffer_dc DESC
      ${paginationSql}
    `;

    const [rows] = await connection.query(dataSql, dataParams);

    const items = rows.map((row, index) => {
      let status = "Aman";
      if (row.cvg_setelah_wip < 7) status = "Kritis";
      else if (row.cvg_setelah_wip <= 15) status = "Perlu Perhatian";

      return {
        ...row,
        status,
        cvg_saat_ini: Number(row.cvg_saat_ini).toFixed(1),
        cvg_setelah_wip: Number(row.cvg_setelah_wip).toFixed(1),
        daily_need: Number(row.daily_need).toFixed(1),
        rekomendasi_spk: Math.max(
          0,
          (row.gap_buffer_dc || 0) - (row.spk_beredar || 0),
        ),
        spk_beredar: row.spk_beredar || 0,
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

// --- Ekstrak jo_kode dari kode SKU (contoh: 'KO-C30S-HITM-005' -> 'KO') ---
// spk_jo_kode di DDL adalah varchar(2), jadi wajib dipotong maks 2 karakter
const extractJoKode = (kodeSku) => {
  if (!kodeSku) return "XX";
  const parts = String(kodeSku).split("-");
  return (parts[0] || "XX").substring(0, 2).toUpperCase();
};

// Sesuaikan jika kode perusahaan/cabang bukan 'KDC'
const PERUSH_KODE_DC = "SM";
const CAB_KODE_DC = "P04";
// Customer dummy untuk SPK replenishment DC (setara SO divisi 3 / KAOSAN)
const CUS_KODE_DC = "DC";
const DIVISI_KAOSAN = 3; // sesuaikan jika divisi Kaosan bukan 3

const generateBulkSpk = async (items, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const today = format(new Date(), "yyyy-MM-dd");
    let generatedCount = 0;

    for (const item of items) {
      if (item.rekomendasi_spk <= 0) continue;

      const joKode = extractJoKode(item.kode);
      const spkNomor = await generateSpkNomorPpic(
        connection,
        PERUSH_KODE_DC,
        joKode,
      );

      // 1. Insert Header SPK — tabel tspk (skema sama dengan SPK PPIC)
      await connection.query(
        `INSERT INTO kencanaprint.tspk (
           spk_nomor, spk_is_so, spk_so_ref,
           spk_tanggal, spk_cus_kode, spk_cus_kaosan,
           spk_jo_kode, spk_divisi, spk_nama, spk_jumlah,
           spk_ukuran, spk_dateline, spk_cab, spk_tipe,
           spk_perush_kode, spk_ketbeli, spk_keterangan,
           spk_aktif, spk_close,
           user_create, date_create
         ) VALUES (?, 0, NULL, ?, ?, '', ?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL 14 DAY), ?, '', ?, ?, ?, 'Y', 0, ?, NOW())`,
        [
          spkNomor,
          today,
          CUS_KODE_DC,
          joKode,
          DIVISI_KAOSAN,
          item.nama,
          item.rekomendasi_spk,
          item.ukuran,
          today,
          CAB_KODE_DC,
          PERUSH_KODE_DC,
          "Rekomendasi otomatis Perencanaan Produksi (DC Planning)",
          `Auto-generate dari Rekomendasi SPK — SKU: ${item.kode} / ${item.ukuran}`,
          user.kode,
        ],
      );

      // 2. Insert Detail Ukuran ke kencanaprint.tspk_size
      await connection.query(
        `INSERT INTO tspk_size (spks_nomor, spks_size, spks_qty)
         VALUES (?, ?, ?)`,
        [spkNomor, item.ukuran, item.rekomendasi_spk],
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
