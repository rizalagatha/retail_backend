const pool = require("../config/database");

/**
 * Mengambil daftar detail hasil hitung stok per operator & device.
 */
const getList = async (filters) => {
  const { cabang, search, startDate, endDate } = filters;

  let query = `
        SELECT 
            h.hs_cab AS Cab,
            h.hs_kode AS Kode,
            h.hs_barcode AS Barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS Nama,
            h.hs_ukuran AS Ukuran,
            h.hs_lokasi AS Lokasi,
            h.hs_operator AS Operator,
            h.hs_device AS Device,
            h.hs_qty AS Jumlah
        FROM thitungstok h
        INNER JOIN tbarangdc a ON a.brg_kode = h.hs_kode
        WHERE h.hs_proses = "N" 
          AND h.hs_cab = ?
          -- [PERBAIKAN] Gunakan DATE() agar jam diabaikan saat filter tanggal
          AND DATE(h.date_create) BETWEEN ? AND ?
    `;

  const params = [cabang, startDate, endDate];

  if (search) {
    query += ` AND (
            h.hs_kode LIKE ? OR 
            h.hs_barcode LIKE ? OR 
            h.hs_operator LIKE ? OR
            h.hs_device LIKE ? OR
            h.hs_lokasi LIKE ? OR
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) LIKE ?
        )`;
    const searchTerm = `%${search}%`;
    params.push(
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm
    );
  }

  query += ` ORDER BY h.date_create DESC, Nama, Barcode`;

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil opsi cabang untuk filter.
 */
const getCabangOptions = async (user) => {
  let query;
  const params = [];
  if (user.cabang === "KDC") {
    query =
      "SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang ORDER BY gdg_kode";
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
