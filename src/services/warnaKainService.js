const pool = require("../config/database");

const getAll = async () => {
  const query = "SELECT Kode, Warna FROM twarna ORDER BY Warna";
  const [rows] = await pool.query(query);
  return rows;
};

const remove = async (warna) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Validasi: Cek apakah warna sudah dipakai di tbarangdc
    const [usageRows] = await connection.query(
      "SELECT 1 FROM tbarangdc WHERE brg_warna = ? LIMIT 1",
      [warna]
    );
    if (usageRows.length > 0) {
      throw new Error(
        "Warna kain ini sudah dipakai di Master Barang dan tidak bisa dihapus."
      );
    }

    const [deleteResult] = await connection.query(
      "DELETE FROM twarna WHERE Warna = ?",
      [warna]
    );
    if (deleteResult.affectedRows === 0) {
      throw new Error("Data tidak ditemukan.");
    }

    await connection.commit();
    return { message: `Warna Kain '${warna}' berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const save = async (data) => {
  const { Kode, Warna } = data;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // --- VALIDASI LENGKAP DARI DELPHI ---
    if (!Kode || !Kode.trim()) throw new Error("Kode tidak boleh kosong.");
    if (!Warna || !Warna.trim())
      throw new Error("Warna kain tidak boleh kosong.");
    if (Kode.length !== 4) throw new Error("Kode harus 4 digit.");
    if (/\s/.test(Kode)) throw new Error("Kode tidak boleh ada spasi.");

    let [rows] = await connection.query("SELECT 1 FROM twarna WHERE Kode = ?", [
      Kode,
    ]);
    if (rows.length > 0) throw new Error("Kode ini sudah ada.");

    [rows] = await connection.query("SELECT 1 FROM twarna WHERE Warna = ?", [
      Warna,
    ]);
    if (rows.length > 0) throw new Error("Warna kain ini sudah diinput.");
    // --- AKHIR VALIDASI ---

    await connection.query("INSERT INTO twarna (Kode, Warna) VALUES (?, ?)", [
      Kode,
      Warna,
    ]);

    await connection.commit();
    return { message: "Warna Kain berhasil disimpan." };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { getAll, remove, save };
