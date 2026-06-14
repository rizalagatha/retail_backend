const pool = require("../config/database");
const moment = require("moment");

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

  // 1. CARI TANGGAL STOK OPNAME AKTIF (Sama seperti versi Mobile)
  const [activeSoRows] = await pool.query(
    `SELECT st_tanggal FROM tsop_tanggal WHERE st_cab = ? AND st_transfer = 'N' ORDER BY st_tanggal DESC LIMIT 1`,
    [user.cabang],
  );

  // Jika tidak ada jadwal SO aktif, jadikan hari ini sebagai default fallback
  const activeSoDate =
    activeSoRows.length > 0
      ? moment(activeSoRows[0].st_tanggal).format("YYYY-MM-DD")
      : moment().format("YYYY-MM-DD");

  // 2. QUERY DENGAN LOGIKA AKUMULASI CERDAS
  const query = `
        INSERT INTO thitungstok 
            (hs_cab, hs_lokasi, hs_barcode, hs_kode, hs_nama, hs_ukuran, hs_qty, hs_proses, date_create, user_create) 
        VALUES (?, ?, ?, ?, ?, ?, 1, 'N', NOW(), ?)
        ON DUPLICATE KEY UPDATE 
            -- JIKA data sudah diposting ('Y') ATAU tanggal scan-nya lebih tua dari SO aktif, TIMPA/RESET ke 1.
            -- JIKA masih di periode SO yang sama ('N'), AKUMULASIKAN (+ 1).
            hs_qty = IF(hs_proses = 'Y' OR date_create IS NULL OR DATE(date_create) < ?, 1, hs_qty + 1),
            hs_proses = 'N', -- Buka kembali status prosesnya
            hs_nama = VALUES(hs_nama),
            date_create = VALUES(date_create),
            user_create = VALUES(user_create)
    `;

  const params = [
    user.cabang,
    lokasi,
    barcode,
    product.brg_kode,
    product.nama,
    product.brgd_ukuran,
    user.kode, // user_create untuk INSERT
    activeSoDate, // parameter tanggal untuk logika IF di ON DUPLICATE KEY UPDATE
  ];

  await pool.query(query, params);

  return { message: "Scan berhasil diproses." };
};

/**
 * Mengambil daftar item yang sudah di-scan untuk lokasi tertentu.
 */
const getScannedItemsByLocation = async (lokasi, user) => {
  const query = `
        SELECT 
            y.barcode, y.kode, y.nama, y.ukuran, y.jumlah, y.lokasi, y.total
        FROM (
            SELECT 
                x.cab, x.barcode, x.kode, x.nama, x.ukuran, x.lokasi, x.total,
                IFNULL((
                    SELECT SUM(i.hs_qty) 
                    FROM thitungstok i 
                    WHERE i.hs_proses = 'N' AND i.hs_lokasi = ? 
                      AND i.hs_cab = x.cab AND i.hs_kode = x.kode AND i.hs_ukuran = x.ukuran
                ), 0) AS jumlah
            FROM (
                SELECT 
                    h.hs_cab AS cab, 
                    h.hs_kode AS kode, 
                    h.hs_barcode AS barcode,
                    TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
                    h.hs_ukuran AS ukuran, 
                    SUM(h.hs_qty) AS total, 
                    CAST(GROUP_CONCAT(CONCAT(h.hs_lokasi,"=",h.hs_qty) SEPARATOR ", ") AS CHAR) AS lokasi
                FROM thitungstok h
                INNER JOIN tbarangdc a ON a.brg_kode = h.hs_kode
                WHERE h.hs_proses = 'N' AND h.hs_cab = ?
                GROUP BY h.hs_kode, h.hs_ukuran
            ) x
        ) y 
        WHERE y.jumlah <> 0 
        ORDER BY y.nama, RIGHT(y.barcode, 2)
    `;

  const [rows] = await pool.query(query, [lokasi, user.cabang]);
  return rows;
};

/**
 * [BARU] Memperbarui Qty secara manual (Tambah/Kurang)
 * Digunakan oleh tombol + dan - di Frontend
 */
const updateQty = async (data, user) => {
  const { lokasi, barcode, delta } = data;

  if (!lokasi || !barcode || delta === undefined) {
    throw new Error("Data tidak lengkap.");
  }

  // Gunakan HS_PROSES = 'N' untuk memastikan hanya stok yang belum diposting yang bisa diubah
  const query = `
        UPDATE thitungstok 
        SET hs_qty = hs_qty + ? 
        WHERE hs_cab = ? AND hs_lokasi = ? AND hs_barcode = ? AND hs_proses = 'N'
    `;

  const [result] = await pool.query(query, [
    delta,
    user.cabang,
    lokasi,
    barcode,
  ]);

  if (result.affectedRows === 0) {
    throw new Error("Data tidak ditemukan atau sudah diposting.");
  }

  return { message: "Jumlah berhasil diperbarui." };
};

const deleteItem = async (data, user) => {
  const { lokasi, barcode } = data;

  if (!lokasi || !barcode) {
    throw new Error("Data tidak lengkap.");
  }

  const query = `
        DELETE FROM thitungstok 
        WHERE hs_cab = ? AND hs_lokasi = ? AND hs_barcode = ? AND hs_proses = 'N'
    `;

  const [result] = await pool.query(query, [user.cabang, lokasi, barcode]);

  if (result.affectedRows === 0) {
    throw new Error("Data tidak ditemukan atau sudah diposting.");
  }

  return { message: "Item berhasil dihapus." };
};

module.exports = {
  getProductByBarcode,
  processScan,
  getScannedItemsByLocation,
  updateQty,
  deleteItem,
};
