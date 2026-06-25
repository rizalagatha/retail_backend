const pool = require("../config/database");

// Mengambil daftar pendaftaran perangkat
const getList = async (filters) => {
  const { status, term } = filters;

  let query = `
        SELECT 
            d.device_id AS deviceId,
            d.user_kode AS kodeUser,
            IFNULL(u.user_nama, 'Unknown') AS namaUser,
            u.user_cab AS cabang,
            d.device_name AS deviceName,
            d.status AS status,
            d.created_at AS tanggalDaftar,
            d.approved_at AS tanggalProses,
            d.approved_by AS diprosesOleh
        FROM tuser_device d
        LEFT JOIN tuser u ON d.user_kode = u.user_kode
        WHERE 1=1
    `;

  const params = [];

  // Filter berdasarkan status (PENDING, APPROVED, REJECTED). Jika kosong, tampilkan semua.
  if (status) {
    query += ` AND d.status = ?`;
    params.push(status);
  }

  // Filter pencarian teks (Nama Kasir, Kode, atau Merk HP)
  if (term) {
    query += ` AND (d.user_kode LIKE ? OR u.user_nama LIKE ? OR d.device_name LIKE ?)`;
    const searchTerm = `%${term}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  query += ` ORDER BY d.status = 'PENDING' DESC, d.created_at DESC`;

  const [rows] = await pool.query(query, params);
  return rows;
};

// Proses Penyetujuan Perangkat
const approveDevice = async (deviceId, approver) => {
  const connection = await pool.getConnection();
  try {
    const [result] = await connection.query(
      `UPDATE tuser_device 
       SET status = 'APPROVED', approved_by = ?, approved_at = NOW() 
       WHERE device_id = ? AND status = 'PENDING'`,
      [approver, deviceId],
    );

    if (result.affectedRows === 0) {
      throw new Error("Perangkat tidak ditemukan atau sudah diproses.");
    }

    return { message: `Perangkat ${deviceId} berhasil disetujui.` };
  } finally {
    connection.release();
  }
};

// Proses Penolakan / Pencabutan Perangkat
const rejectDevice = async (deviceId, approver) => {
  const connection = await pool.getConnection();
  try {
    const [result] = await connection.query(
      `UPDATE tuser_device 
       SET status = 'REJECTED', approved_by = ?, approved_at = NOW() 
       WHERE device_id = ?`,
      [approver, deviceId],
    );

    if (result.affectedRows === 0) {
      throw new Error("Perangkat tidak ditemukan.");
    }

    return { message: `Izin perangkat ${deviceId} berhasil dicabut/ditolak.` };
  } finally {
    connection.release();
  }
};

module.exports = {
  getList,
  approveDevice,
  rejectDevice,
};
