const pool = require("../config/database");

/**
 * Mengambil daftar selisih stok opname.
 */
const getList = async (filters) => {
  const { cabang, search } = filters;

  // Langkah 1: Dapatkan tanggal stok opname
  const [sopTanggalRows] = await pool.query(
    "SELECT st_tanggal FROM tsop_tanggal WHERE st_cab = ? AND st_transfer = 'N' LIMIT 1",
    [cabang]
  );

  if (sopTanggalRows.length === 0) {
    throw new Error(
      `Tidak ada tanggal stok opname yang aktif untuk cabang ${cabang}. Silakan setting terlebih dahulu.`
    );
  }
  const zsoptgl = sopTanggalRows[0].st_tanggal;

  // Langkah 2: Subquery
  let baseSubQuery = `
        SELECT 
            y.Kode, y.Barcode, y.Nama, y.Ukuran, (y.showroom + y.pesan) AS Stok, y.hitung AS Hitung, y.Selisih,
            IFNULL(CAST(GROUP_CONCAT(CONCAT(h.hs_lokasi, "=", h.hs_qty) SEPARATOR ", ") AS CHAR), "") AS Lokasi,
            IFNULL((
                SELECT SUM(d.invd_jumlah) 
                FROM tinv_dtl d
                INNER JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
                WHERE d.invd_kode = y.Kode AND d.invd_ukuran = y.ukuran AND h.inv_tanggal >= ?
            ), 0) AS Invoice
        FROM (
            SELECT 
                x.*, (x.hitung - (x.showroom + x.pesan)) AS Selisih
            FROM (
                SELECT 
                    a.brg_kode AS Kode, b.brgd_barcode AS Barcode, 
                    TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS Nama,
                    b.brgd_ukuran AS Ukuran,
                    IFNULL((
                        SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                        FROM tmasterstok m 
                        WHERE m.mst_aktif = "Y" AND m.mst_cab = ? AND m.mst_tanggal < ? 
                          AND m.mst_brg_kode = b.brgd_kode AND m.mst_ukuran = b.brgd_ukuran
                    ), 0) AS showroom,
                    IFNULL((
                        SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                        FROM tmasterstokso m 
                        WHERE m.mst_aktif = "Y" AND m.mst_cab = ? AND m.mst_tanggal < ? 
                          AND m.mst_brg_kode = b.brgd_kode AND m.mst_ukuran = b.brgd_ukuran
                    ), 0) AS pesan,
                    IFNULL((
                        SELECT SUM(u.hs_qty) 
                        FROM thitungstok u 
                        WHERE u.hs_proses = "N" AND u.hs_cab = ? 
                          AND u.hs_kode = b.brgd_kode AND u.hs_ukuran = b.brgd_ukuran
                    ), 0) AS hitung
                FROM tbarangdc a
                LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = a.brg_kode
                WHERE a.brg_logstok = "Y"
            ) x
            WHERE (x.showroom + x.pesan) <> 0 OR x.hitung <> 0
        ) y
        LEFT JOIN thitungstok h ON h.hs_kode = y.kode AND h.hs_ukuran = y.ukuran AND h.hs_proses = "N" AND h.hs_cab = ?
        GROUP BY y.kode, y.ukuran 
    `;

  // Array parameter awal
  const params = [zsoptgl, cabang, zsoptgl, cabang, zsoptgl, cabang, cabang];

  // Wrapper Query untuk Filter
  let query = `SELECT * FROM (${baseSubQuery}) AS FinalResult`;

  // Tambahkan Logika Search
  if (search) {
    query += ` WHERE Nama LIKE ? OR Kode LIKE ? OR Barcode LIKE ?`;
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  query += ` ORDER BY Nama, RIGHT(Barcode, 2)`;

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil opsi cabang untuk filter.
 */
const getCabangOptions = async (user) => {
  // ... (fungsi ini sama seperti modul sebelumnya, bisa di-copy-paste)
  let query;
  const params = [];
  if (user.cabang === "KDC") {
    query =
      'SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_dc<>0 AND gdg_kode NOT IN ("KBS","KPS") ORDER BY gdg_kode';
  } else {
    query =
      "SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode = ? ORDER BY gdg_kode";
    params.push(user.cabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getCabangOptions,
};
