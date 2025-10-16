const pool = require("../config/database");
const { format } = require("date-fns");

/**
 * Ambil daftar otorisasi berdasarkan rentang tanggal
 * @param {object} filters - Filter dari frontend (req.query)
 * @param {string} filters.startDate - Tanggal mulai (format YYYY-MM-DD)
 * @param {string} filters.endDate - Tanggal akhir (format YYYY-MM-DD)
 */
const getListOtorisasi = async (filters) => {
  const { startDate, endDate } = filters;

  // Validasi input tanggal
  if (!startDate || !endDate) {
    throw new Error("Tanggal mulai (startDate) dan tanggal akhir (endDate) harus diisi.");
  }

  const query = `
    SELECT 
      o.o_nomor AS nomor,
      o.o_transaksi AS transaksi,
      o.o_jenis AS jenis,
      o.o_nominal AS nominal,
      COALESCE(
        (SELECT t.nama FROM totoritator t WHERE t.kode = RIGHT(o.o_pin, 1)),
        ''
      ) AS otoritator,
      DATE_FORMAT(o.o_created, '%d-%m-%Y %H:%i:%s') AS tanggal,
      o.o_barcode AS barcode
    FROM totorisasi o
    WHERE DATE(o.o_created) BETWEEN ? AND ?
    ORDER BY o.o_created DESC
  `;

  const params = [startDate, endDate];

  try {
    const [rows] = await pool.query(query, params);
    return rows;
  } catch (error) {
    console.error("Error fetching otorisasi list:", error);
    throw new Error("Gagal mengambil data daftar otorisasi dari database.");
  }
};

module.exports = {
  getListOtorisasi,
};
