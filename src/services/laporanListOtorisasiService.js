const pool = require("../config/database");

const getListOtorisasi = async (filters) => {
  const { startDate, endDate } = filters;

  if (!startDate || !endDate) {
    throw new Error("Tanggal mulai dan akhir harus diisi.");
  }

  const query = `
    SELECT 
      o.o_nomor AS nomor,
      o.o_transaksi AS transaksi,
      o.o_jenis AS jenis,
      o.o_nominal AS nominal,
      
      -- LOGIKA APPROVER
      COALESCE(
        NULLIF(o.o_approver, ''), 
        NULLIF(o.o_approver, '-'),
        (SELECT t.nama FROM totoritator t WHERE t.kode = RIGHT(o.o_pin, 1)),
        '-'
      ) AS approver,

      -- REQUESTER (Pastikan kolom o_requester ada, jika error hapus baris ini)
      COALESCE(o.o_requester, '-') AS requester,

      -- KETERANGAN / ALASAN (Digabung di sini)
     COALESCE(o.o_ket, '') AS keterangan,

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
    // Tampilkan pesan error asli agar mudah debug jika ada kolom lain yang kurang
    throw new Error(`Gagal mengambil data: ${error.message}`);
  }
};

module.exports = { getListOtorisasi };