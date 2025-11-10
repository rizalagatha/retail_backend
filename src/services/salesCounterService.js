const pool = require("../config/database");

const getAllSalesCounters = async (user) => {
  // Terima parameter 'user'
  const userCabang = user.cabang;
  const isKdc = userCabang === "KDC";

  // Query diubah untuk JOIN dengan tabel user
  let query = `
    SELECT 
      sc.sc_kode AS kode,
      sc.sc_nama AS nama,
      sc.sc_alamat AS alamat,
      sc.sc_hp AS hp,
      sc.sc_ktp AS ktp,
      IF(sc.sc_aktif = 'Y', 'AKTIF', 'PASIF') AS status
    FROM tsalescounter sc
    LEFT JOIN tuser u ON sc.sc_kode = u.user_kode 
    -- ^ Asumsi: tabel user = 'tuser', key = 'user_kode'
  `;

  const params = [];

  if (!isKdc) {
    // Jika bukan KDC, filter berdasarkan cabang
    query += " WHERE u.user_cab = ?"; 
    params.push(userCabang);
  }

  query += " ORDER BY sc.sc_nama;";

  const [rows] = await pool.query(query, params);
  return rows;
};

const saveSalesCounter = async (data) => {
  const { isNew, kode, nama, alamat, hp, ktp, status } = data;
  const scAktif = status === "AKTIF" ? "Y" : "N";

  if (isNew) {
    await pool.query(
      "INSERT INTO tsalescounter (sc_kode, sc_nama, sc_alamat, sc_hp, sc_ktp, sc_aktif) VALUES (?, ?, ?, ?, ?, ?)",
      [kode, nama, alamat, hp, ktp, scAktif]
    );
  } else {
    await pool.query(
      "UPDATE tsalescounter SET sc_nama = ?, sc_alamat = ?, sc_hp = ?, sc_ktp = ?, sc_aktif = ? WHERE sc_kode = ?",
      [nama, alamat, hp, ktp, scAktif, kode]
    );
  }
  return { success: true, message: "Data sales counter berhasil disimpan." };
};

const deleteSalesCounter = async (kode) => {
  await pool.query("DELETE FROM tsalescounter WHERE sc_kode = ?", [kode]);
  return { success: true, message: "Data sales counter berhasil dihapus." };
};

module.exports = {
  getAllSalesCounters,
  saveSalesCounter,
  deleteSalesCounter,
};
