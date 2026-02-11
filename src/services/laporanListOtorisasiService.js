// services/laporanListOtorisasiService.js
const pool = require("../config/database");

const getListOtorisasi = async (filters) => {
  const { startDate, endDate } = filters;
  if (!startDate || !endDate)
    throw new Error("Tanggal mulai dan akhir harus diisi.");

  const query = `
    SELECT 
      o.o_nomor AS nomor,
      o.o_transaksi AS transaksi_riil,
      o.o_jenis AS jenis,
      o.o_nominal AS nominal,
      COALESCE(
        NULLIF(o.o_approver, ''), 
        NULLIF(o.o_approver, '-'),
        (SELECT t.nama FROM totoritator t WHERE t.kode = RIGHT(o.o_pin, 1)),
        '-'
      ) AS approver,
      COALESCE(o.o_requester, '-') AS requester,
      COALESCE(o.o_ket, '') AS keterangan,
      DATE_FORMAT(o.o_created, '%d-%m-%Y %H:%i:%s') AS tanggal,
      o.o_barcode AS barcode
    FROM totorisasi o
    WHERE DATE(o.o_created) BETWEEN ? AND ?
      AND o.o_nomor LIKE '%.AUTH.%'
    ORDER BY o.o_created DESC
  `;

  const [rows] = await pool.query(query, [startDate, endDate]);
  return rows;
};

// PERBAIKAN: Hanya menerima string, bukan (req, res)
const getDetailTransaksi = async (auth_nomor) => {
  if (!auth_nomor) {
    throw new Error("Nomor otorisasi tidak valid.");
  }

  // Ambil data langsung dari totorisasi menggunakan nomor AUTH sebagai filter
  const query = `
    SELECT 
      o_transaksi AS o_nomor, 
      o_jenis, 
      o_nominal, 
      o_ket, 
      o_barcode, 
      DATE_FORMAT(o_created, '%d-%m-%Y %H:%i:%s') as o_tanggal
    FROM totorisasi
    WHERE o_nomor = ? 
      AND o_transaksi IS NOT NULL 
      AND o_transaksi <> ''
    ORDER BY o_created DESC
  `;

  const [rows] = await pool.query(query, [auth_nomor]);
  return rows;
};

module.exports = { getListOtorisasi, getDetailTransaksi };
