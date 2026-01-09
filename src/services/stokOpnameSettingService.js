const pool = require("../config/database");
const { format } = require("date-fns");

/**
 * Mengambil daftar tanggal stok opname yang sudah di-setting untuk cabang user.
 */
const getList = async (user) => {
  let query = `SELECT st_cab AS cabang, st_tanggal AS tanggal, st_transfer AS transfer 
                 FROM tsop_tanggal`;
  const params = [];

  // Jika BUKAN KDC, kunci hanya untuk cabangnya sendiri
  if (user.cabang !== "KDC") {
    query += ` WHERE st_cab = ?`;
    params.push(user.cabang);
  }

  query += ` ORDER BY st_tanggal DESC`;
  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Menetapkan tanggal stok opname baru.
 */
const setDate = async (payload, user) => {
  const { tanggal, cabangTarget } = payload;
  // Tentukan cabang mana yang akan di-setting
  // Jika KDC, gunakan inputan cabangTarget. Jika cabang biasa, gunakan user.cabang
  const target = user.cabang === "KDC" ? cabangTarget : user.cabang;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Validasi: Cek apakah cabang tersebut sudah punya SO aktif
    const [existing] = await connection.query(
      "SELECT 1 FROM tsop_tanggal WHERE st_transfer = 'N' AND st_cab = ? LIMIT 1",
      [target]
    );
    if (existing.length > 0) {
      throw new Error(`Cabang ${target} sudah memiliki jadwal SO yang aktif.`);
    }

    await connection.query(
      "INSERT INTO tsop_tanggal (st_cab, st_tanggal) VALUES (?, ?)",
      [target, tanggal]
    );

    await connection.commit();
    return {
      message: `Tanggal SO untuk cabang ${target} berhasil ditetapkan.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Menghapus tanggal stok opname.
 */
const deleteDate = async (tanggal, cabangTarget, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Tentukan target: Jika KDC, gunakan parameter cabangTarget. Jika cabang biasa, gunakan miliknya sendiri.
    const target = user.cabang === "KDC" ? cabangTarget : user.cabang;

    // Ambil data untuk validasi
    const [rows] = await connection.query(
      "SELECT st_transfer FROM tsop_tanggal WHERE st_cab = ? AND st_tanggal = ?",
      [target, tanggal]
    );

    if (rows.length === 0) {
      throw new Error(
        `Data tanggal untuk cabang ${target} tidak ditemukan di database.`
      );
    }

    // Validasi: Cek apakah sudah ditransfer
    if (rows[0].st_transfer === "Y") {
      throw new Error(
        "Tanggal ini sudah ditransfer (SUDAH) dan tidak bisa dihapus."
      );
    }

    // Lakukan penghapusan berdasarkan cabang spesifik
    await connection.query(
      "DELETE FROM tsop_tanggal WHERE st_cab = ? AND st_tanggal = ?",
      [target, tanggal]
    );

    await connection.commit();
    return { message: `Jadwal stok opname cabang ${target} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  getList,
  setDate,
  deleteDate,
};
