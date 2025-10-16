const pool = require("../config/database");

const getAll = async () => {
  const query = "SELECT Kode, JenisKain FROM tjeniskain ORDER BY JenisKain";
  const [rows] = await pool.query(query);
  return rows;
};

const remove = async (jenisKain) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Validasi: Cek apakah jenis kain sudah dipakai di tbarangdc
    const [usageRows] = await connection.query(
      "SELECT 1 FROM tbarangdc WHERE brg_jeniskain = ? LIMIT 1",
      [jenisKain]
    );
    if (usageRows.length > 0) {
      throw new Error(
        "Jenis kain ini sudah dipakai di Master Barang dan tidak bisa dihapus."
      );
    }

    // Jika tidak dipakai, lanjutkan proses hapus
    const [deleteResult] = await connection.query(
      "DELETE FROM tjeniskain WHERE JenisKain = ?",
      [jenisKain]
    );

    if (deleteResult.affectedRows === 0) {
      throw new Error("Data tidak ditemukan.");
    }

    await connection.commit();
    return { message: `Jenis Kain '${jenisKain}' berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const save = async (data) => {
  const { Kode, JenisKain } = data;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // --- VALIDASI DARI DELPHI ---
    if (!Kode || Kode.trim() === "")
      throw new Error("Kode kain tidak boleh kosong.");
    if (!JenisKain || JenisKain.trim() === "")
      throw new Error("Jenis kain tidak boleh kosong.");
    if (Kode.length !== 4) throw new Error("Kode harus 4 digit.");
    if (Kode.includes(" ")) throw new Error("Kode tidak boleh ada spasi.");

    let [rows] = await connection.query(
      "SELECT 1 FROM tjeniskain WHERE Kode = ?",
      [Kode]
    );
    if (rows.length > 0) throw new Error("Kode kain ini sudah ada.");

    [rows] = await connection.query(
      "SELECT 1 FROM tjeniskain WHERE JenisKain = ?",
      [JenisKain]
    );
    if (rows.length > 0) throw new Error("Jenis kain ini sudah ada.");
    // --- AKHIR VALIDASI ---

    await connection.query(
      "INSERT INTO tjeniskain (Kode, JenisKain) VALUES (?, ?)",
      [Kode, JenisKain]
    );

    await connection.commit();
    return { message: "Jenis Kain berhasil disimpan." };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { getAll, remove, save };
