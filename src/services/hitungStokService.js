const pool = require("../config/database");

/**
 * Mengambil daftar ringkasan hasil hitung stok.
 */
const getList = async (filters) => {
  const { cabang, search } = filters; // 1. Ambil parameter search

  // Query dasar (Subquery)
  let baseSubQuery = `
        SELECT 
            h.hs_cab AS Cab,
            h.hs_kode AS Kode,
            h.hs_barcode AS Barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS Nama,
            h.hs_ukuran AS Ukuran, 
            SUM(h.hs_qty) AS Fisik, 
            CAST(GROUP_CONCAT(CONCAT(h.hs_lokasi, "=", h.hs_qty) SEPARATOR ", ") AS CHAR) AS Lokasi
        FROM thitungstok h
        INNER JOIN tbarangdc a ON a.brg_kode = h.hs_kode
        WHERE h.hs_proses = "N" AND h.hs_cab = ?
        GROUP BY h.hs_kode, h.hs_ukuran
  `;

  // Query Utama
  let query = `SELECT x.Cab, x.Kode, x.Barcode, x.Nama, x.Ukuran, x.Fisik, x.Lokasi FROM (${baseSubQuery}) X`;

  const params = [cabang];

  // 2. Tambahkan Logika Filter Pencarian
  if (search) {
    query += ` WHERE x.Nama LIKE ? OR x.Kode LIKE ? OR x.Barcode LIKE ? `;
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  // 3. Order By
  query += ` ORDER BY x.Kode, RIGHT(x.Barcode, 2)`;

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
