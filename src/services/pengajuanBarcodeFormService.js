const pool = require("../config/database");

const getForEdit = async (nomor, userCabang) => {
  // 1. Ambil data Header
  const headerQuery = `SELECT pc_nomor AS nomor, pc_tanggal AS tanggal, pc_acc AS approved FROM tpengajuanbarcode_hdr WHERE pc_nomor = ?`;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0) throw new Error("Dokumen tidak ditemukan.");

  // 2. Ambil data Item Pengajuan (_dtl) dan gabungkan dengan data approval (_dtl2)
  const itemsQuery = `
        SELECT 
            d.pcd_kode AS kode, b.brgd_barcode AS barcode, d.pcd_ukuran AS ukuran, d.pcd_jumlah AS jumlah,
            b.brgd_harga AS harga, d.pcd_jenis AS jenis, d.pcd_ket AS ket, b.brgd_hpp AS hpp,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
            IFNULL((SELECT SUM(m.mst_stok_in-m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif='Y' AND m.mst_cab=? AND m.mst_brg_kode=d.pcd_kode AND m.mst_ukuran=d.pcd_ukuran), 0) AS stok,
            d2.pcd2_kodein AS kodebaru, 
            d2.pcd2_diskon AS diskon, 
            d2.pcd2_harga AS hargabaru
        FROM tpengajuanbarcode_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.pcd_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.pcd_kode AND b.brgd_ukuran = d.pcd_ukuran
        LEFT JOIN tpengajuanbarcode_dtl2 d2 ON d2.pcd2_nomor = d.pcd_nomor AND d2.pcd2_kode = d.pcd_kode AND d2.pcd2_ukuran = d.pcd_ukuran
        WHERE d.pcd_nomor = ?;
    `;
  const [items] = await pool.query(itemsQuery, [userCabang, nomor]);

  // 3. Ambil data Stiker (_sticker)
  const stickersQuery = `
        SELECT
            s.pcs_kode, s.pcs_kodes, s.pcs_ukuran, s.pcs_jumlah,
            b.brgd_barcode, b.brgd_harga AS harga,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
            IFNULL((SELECT SUM(m.mst_stok_in-m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif='Y' AND m.mst_cab=? AND m.mst_brg_kode=s.pcs_kodes AND m.mst_ukuran=s.pcs_ukuran), 0) AS stok
        FROM tpengajuanbarcode_sticker s
        LEFT JOIN tbarangdc a ON a.brg_kode = s.pcs_kodes
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = s.pcs_kodes AND b.brgd_ukuran = s.pcs_ukuran
        WHERE s.pcs_nomor = ?;
    `;
  const [stickers] = await pool.query(stickersQuery, [userCabang, nomor]);

  return { header: headerRows[0], items, stickers };
};

const save = async (payload, user) => {
  const { header, items, stickers, isNew, isApproved } = payload;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let nomorDokumen = header.nomor;

    if (isNew) {
      const yearMonth = new Date(header.tanggal)
        .toISOString()
        .slice(2, 7)
        .replace("-", "");
      const prefix = `${user.cabang}.RJT.${yearMonth}`;
      const nomorQuery = `SELECT IFNULL(MAX(RIGHT(pc_nomor, 5)), 0) + 1 AS next_num FROM tpengajuanbarcode_hdr WHERE LEFT(pc_nomor, 12) = ?;`;
      const [nomorRows] = await connection.query(nomorQuery, [prefix]);
      nomorDokumen = `${prefix}${nomorRows[0].next_num
        .toString()
        .padStart(5, "0")}`;
      await connection.query(
        "INSERT INTO tpengajuanbarcode_hdr (pc_nomor, pc_tanggal, user_create, date_create) VALUES (?, ?, ?, NOW())",
        [nomorDokumen, header.tanggal, user.kode]
      );
    }

    if (isApproved) {
      // == ALUR APPROVAL ==
      // 1. Update header dengan status ACC
      await connection.query(
        "UPDATE tpengajuanbarcode_hdr SET pc_acc = ?, date_acc = NOW() WHERE pc_nomor = ?",
        [user.kode, nomorDokumen]
      );

      // 2. Loop item yang disetujui untuk dibuat produk baru
      for (const item of items) {
        if (item.hargabaru > 0) {
          const newProductCode =
            item.kodebaru || (await generateNewProductCode(connection));
          const newProductName = `${item.nama} #${item.jenis.substring(0, 1)}`;

          // Insert/Update ke tbarangdc (master produk)
          await connection.query(
            'INSERT INTO tbarangdc (brg_kode, brg_ktgp, brg_aktif, brg_logstok, brg_kelompok, brg_warna, user_create, date_create) VALUES (?, ?, 0, "Y", "C", ?, ?, NOW()) ON DUPLICATE KEY UPDATE brg_ktgp=VALUES(brg_ktgp), brg_warna=VALUES(brg_warna)',
            [newProductCode, item.jenis, newProductName, user.kode]
          );

          // Insert/Update ke tbarangdc_dtl (varian produk)
          await connection.query(
            "INSERT INTO tbarangdc_dtl (brgd_kode, brgd_barcode, brgd_ukuran, brgd_hpp, brgd_harga) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE brgd_hpp=VALUES(brgd_hpp), brgd_harga=VALUES(brgd_harga)",
            [
              newProductCode,
              newProductCode,
              item.ukuran,
              item.hpp,
              item.hargabaru,
            ]
          );

          // Simpan ke tabel log approval _dtl2
          await connection.query(
            "INSERT INTO tpengajuanbarcode_dtl2 (pcd2_nomor, pcd2_kode, pcd2_kodein, pcd2_ukuran, pcd2_diskon, pcd2_harga) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE pcd2_diskon=VALUES(pcd2_diskon), pcd2_harga=VALUES(pcd2_harga)",
            [
              nomorDokumen,
              item.kode,
              newProductCode,
              item.ukuran,
              item.diskon,
              item.hargabaru,
            ]
          );
        }
      }
      // (Tambahkan logika untuk tpengajuanbarcode_sticker2 jika ada)
    } else {
      // == ALUR SIMPAN DRAF / PENGAJUAN BIASA ==
      await connection.query(
        "UPDATE tpengajuanbarcode_hdr SET pc_tanggal = ?, user_modified = ?, date_modified = NOW() WHERE pc_nomor = ?",
        [header.tanggal, user.kode, nomorDokumen]
      );

      // Pola Delete-then-Insert untuk detail
      await connection.query(
        "DELETE FROM tpengajuanbarcode_dtl WHERE pcd_nomor = ?",
        [nomorDokumen]
      );
      if (items.length > 0) {
        const itemValues = items.map((item, i) => [
          nomorDokumen,
          item.kode,
          item.ukuran,
          item.jumlah,
          item.jenis,
          item.ket,
          i + 1,
        ]);
        await connection.query(
          "INSERT INTO tpengajuanbarcode_dtl (pcd_nomor, pcd_kode, pcd_ukuran, pcd_jumlah, pcd_jenis, pcd_ket, pcd_nourut) VALUES ?",
          [itemValues]
        );
      }
      // (Tambahkan logika delete-then-insert untuk tpengajuanbarcode_sticker)
    }
    // --- AKHIR LOGIKA UTAMA ---

    await connection.commit();
    return {
      message: `Pengajuan berhasil disimpan dengan nomor ${nomorDokumen}`,
      nomor: nomorDokumen,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const lookupProducts = async (filters) => {
  const { term, gudang, page, itemsPerPage } = filters;
  const limit = parseInt(itemsPerPage, 10) || 10;
  const pageNum = parseInt(page, 10) || 1;
  const offset = (pageNum - 1) * limit;
  const searchTerm = term ? `%${term}%` : null;

  // Query dari Delphi: a.brg_aktif=0 and a.brg_logstok="Y" and a.brg_kelompok=""
  let fromClause = `
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
    `;
  let whereClause =
    'WHERE a.brg_aktif = 0 AND a.brg_logstok = "Y" AND a.brg_kelompok = ""';
  let params = [];

  if (term) {
    whereClause += ` AND (b.brgd_barcode LIKE ? OR b.brgd_kode LIKE ? OR TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) LIKE ?)`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  const countQuery = `SELECT COUNT(*) as total ${fromClause} ${whereClause}`;
  const [countRows] = await pool.query(countQuery, params);

  // --- PERBAIKAN DI SINI ---
  let dataQuery = `
        SELECT
            b.brgd_barcode AS barcode, b.brgd_kode AS kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran, b.brgd_harga AS harga,
            CONCAT(b.brgd_kode, '-', b.brgd_ukuran) AS uniqueId,
            IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif='Y' AND m.mst_cab=? AND m.mst_brg_kode=b.brgd_kode AND m.mst_ukuran=b.brgd_ukuran), 0) AS stok
        ${fromClause} ${whereClause}
        ORDER BY nama, b.brgd_ukuran
    `;
  // Siapkan parameter awal
  let dataParams = [gudang, ...params];

  // Hanya tambahkan LIMIT jika nilainya positif
  if (limit > 0) {
    dataQuery += ` LIMIT ? OFFSET ?`;
    dataParams.push(limit, offset);
  }
  // --- AKHIR PERBAIKAN ---

  const [items] = await pool.query(dataQuery, dataParams);
  return { items, total: countRows[0].total };
};

const getJenisReject = async () => {
  const [rows] = await pool.query(
    "SELECT jenis FROM tjenisreject ORDER BY jenis"
  );
  return rows.map((r) => r.jenis);
};

const generateNewProductCode = async (connection) => {
  const year = new Date().getFullYear().toString().substring(2);
  const query = `SELECT IFNULL(MAX(LEFT(brg_kode, 6)), 0) AS last_num FROM tbarangdc WHERE brg_kelompok='C' AND RIGHT(brg_kode, 2) = ?;`;
  const [rows] = await connection.query(query, [year]);
  const nextNum = (parseInt(rows[0].last_num, 10) + 1)
    .toString()
    .padStart(6, "0");
  return `${nextNum}${year}`;
};

const getProductDetails = async (filters) => {
  const { kode, ukuran, gudang } = filters;
  const query = `
        SELECT 
            b.brgd_kode AS kode, 
            b.brgd_barcode AS barcode, 
            b.brgd_harga AS harga,
            b.brgd_hpp AS hpp,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                FROM tmasterstok m 
                WHERE m.mst_aktif = 'Y' 
                  AND m.mst_cab = ? 
                  AND m.mst_brg_kode = ? 
                  AND m.mst_ukuran = ?
            ), 0) AS stok
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
        WHERE a.brg_aktif = 0 
          AND b.brgd_kode = ? 
          AND b.brgd_ukuran = ?;
    `;
  const params = [gudang, kode, ukuran, kode, ukuran];
  const [rows] = await pool.query(query, params);
  if (rows.length === 0) {
    throw new Error("Detail produk tidak ditemukan.");
  }
  return rows[0];
};

const lookupStickers = async (filters) => {
  const { term, gudang, page, itemsPerPage } = filters;
  const pageNum = parseInt(page, 10) || 1;
  const limit = parseInt(itemsPerPage, 10) || 10;
  const offset = (pageNum - 1) * limit;
  const searchTerm = term ? `%${term}%` : null;

  // Query dari Delphi: a.brg_kelompok="S"
  let fromClause = `
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
    `;
  // Filter utama untuk stiker
  let whereClause =
    'WHERE a.brg_aktif = 0 AND a.brg_logstok = "Y" AND a.brg_kelompok = "S"';
  let params = [];

  if (term) {
    whereClause += ` AND (b.brgd_barcode LIKE ? OR b.brgd_kode LIKE ? OR TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) LIKE ?)`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  const countQuery = `SELECT COUNT(*) as total ${fromClause} ${whereClause}`;
  const [countRows] = await pool.query(countQuery, params);

  const dataQuery = `
        SELECT
            b.brgd_barcode AS barcode,
            b.brgd_kode AS kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            b.brgd_harga AS harga,
            CONCAT(b.brgd_kode, '-', b.brgd_ukuran) AS uniqueId,
            IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif='Y' AND m.mst_cab=? AND m.mst_brg_kode=b.brgd_kode AND m.mst_ukuran=b.brgd_ukuran), 0) AS stok
        ${fromClause} ${whereClause}
        ORDER BY nama, b.brgd_ukuran LIMIT ? OFFSET ?
    `;
  const dataParams = [gudang, ...params, limit, offset];

  const [items] = await pool.query(dataQuery, dataParams);
  return { items, total: countRows[0].total };
};

const getDataForBarcodePrint = async (nomor) => {
    // Query ini secara langsung mengambil hasil approval dari tabel _dtl2
    // dan mengambil nama barang dari tbarangdc
    const query = `
        SELECT 
            d2.pcd2_kodein AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d2.pcd2_ukuran AS ukuran,
            d2.pcd2_harga AS harga,
            d2.pcd2_jumlah AS jumlah
        FROM tpengajuanbarcode_dtl2 d2
        LEFT JOIN tbarangdc a ON a.brg_kode = d2.pcd2_kode
        WHERE d2.pcd2_nomor = ?;
    `;
    const [rows] = await pool.query(query, [nomor]);
    
    if (rows.length === 0) {
        throw new Error('Tidak ada data barcode baru yang sudah di-approve untuk dicetak pada dokumen ini.');
    }
    return rows;
};

module.exports = {
  getForEdit,
  save,
  lookupProducts,
  getJenisReject,
  getProductDetails,
  lookupStickers,
  getDataForBarcodePrint,
};
