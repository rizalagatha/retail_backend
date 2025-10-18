const pool = require("../config/database");

/**
 * Mengambil detail barang berdasarkan barcode.
 */
const getProductByBarcode = async (barcode) => {
  const query = `
        SELECT 
            a.brg_kode,
            b.brgd_ukuran,
            b.brgd_barcode,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama
        FROM tbarangdc a
        INNER JOIN tbarangdc_dtl b ON b.brgd_kode = a.brg_kode
        WHERE b.brgd_barcode = ?
    `;
  const [rows] = await pool.query(query, [barcode]);
  if (rows.length === 0) {
    throw new Error("Barcode tidak terdaftar.");
  }
  return rows[0];
};

/**
 * Memproses scan: menambah atau memperbarui jumlah stok di thitungstok.
 */
const processScan = async (data, user) => {
  const { lokasi, barcode, product } = data;

  // Validasi dasar
  if (!lokasi || !barcode || !product) {
    throw new Error("Data tidak lengkap.");
  }

  // Query dari Delphi: INSERT ... ON DUPLICATE KEY UPDATE
  // Ini sangat efisien untuk menambah jumlah jika data sudah ada, atau membuat baru jika belum.
  // Asumsi PRIMARY KEY atau UNIQUE KEY di tabel thitungstok adalah (hs_cab, hs_lokasi, hs_kode, hs_ukuran)
  const query = `
        INSERT INTO thitungstok 
            (hs_cab, hs_lokasi, hs_barcode, hs_kode, hs_nama, hs_ukuran, hs_qty, hs_proses, date_create, user_create) 
        VALUES (?, ?, ?, ?, ?, ?, 1, 'N', CURDATE(), ?)
        ON DUPLICATE KEY UPDATE hs_nama = ?, hs_qty = hs_qty + 1
    `;

  const params = [
    user.cabang,
    lokasi,
    barcode,
    product.brg_kode,
    product.nama,
    product.brgd_ukuran,
    user.kode, // Untuk INSERT
    product.nama, // Untuk UPDATE
  ];

  await pool.query(query, params);

  return { message: "Scan berhasil diproses." };
};

/**
 * Mengambil daftar item yang sudah di-scan untuk lokasi tertentu.
 */
const getScannedItemsByLocation = async (lokasi, user) => {
  // Query ini adalah terjemahan dari loaddetail di Delphi
  const query = `
        SELECT 
            y.Barcode, y.Kode, y.Nama, y.Ukuran, y.jumlah, y.lokasi, y.total
        FROM (
            SELECT 
                x.cab, x.Barcode, x.Kode, x.Nama, x.Ukuran, x.Lokasi, x.total,
                IFNULL((
                    SELECT SUM(i.hs_qty) 
                    FROM thitungstok i 
                    WHERE i.hs_proses = 'N' AND i.hs_lokasi = ? 
                      AND i.hs_cab = x.cab AND i.hs_kode = x.Kode AND i.hs_ukuran = x.Ukuran
                ), 0) AS jumlah
            FROM (
                SELECT 
                    h.hs_cab AS Cab, h.hs_kode AS Kode, h.hs_barcode AS Barcode,
                    TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS Nama,
                    h.hs_ukuran AS Ukuran, 
                    SUM(h.hs_qty) AS total, 
                    CAST(GROUP_CONCAT(CONCAT(h.hs_lokasi,"=",h.hs_qty) SEPARATOR ", ") AS CHAR) AS lokasi
                FROM thitungstok h
                INNER JOIN tbarangdc a ON a.brg_kode = h.hs_kode
                WHERE h.hs_proses = 'N' AND h.hs_cab = ?
                GROUP BY h.hs_kode, h.hs_ukuran
            ) x
        ) y 
        WHERE y.jumlah <> 0 
        ORDER BY y.Nama, RIGHT(y.barcode, 2)
    `;

  const [rows] = await pool.query(query, [lokasi, user.cabang]);
  return rows;
};

module.exports = {
  getProductByBarcode,
  processScan,
  getScannedItemsByLocation,
};
