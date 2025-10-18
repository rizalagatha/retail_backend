const pool = require("../config/database");

/**
 * Mengambil daftar detail hasil hitung stok per lokasi.
 */
const getList = async (filters) => {
  const { cabang } = filters;

  // Query ini adalah terjemahan dari SQLMaster di Delphi
  const query = `
        SELECT 
            h.hs_cab AS Cab,
            h.hs_kode AS Kode,
            h.hs_barcode AS Barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS Nama,
            h.hs_ukuran AS Ukuran,
            h.hs_lokasi AS Lokasi,
            h.hs_qty AS Jumlah
        FROM thitungstok h
        INNER JOIN tbarangdc a ON a.brg_kode = h.hs_kode
        WHERE h.hs_proses = "N" AND h.hs_cab = ?
        ORDER BY Nama, Barcode, Lokasi
    `;

  const [rows] = await pool.query(query, [cabang]);
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
