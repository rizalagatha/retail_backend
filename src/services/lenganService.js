const pool = require("../config/database");

const getAll = async () => {
  const query = "SELECT Lengan FROM tlengan ORDER BY Lengan";
  const [rows] = await pool.query(query);
  return rows;
};

const save = async (data) => {
  const { Lengan } = data;
  // --- VALIDASI ---
  if (!Lengan || !Lengan.trim()) {
    throw new Error("Nama Lengan tidak boleh kosong.");
  }

  const [exists] = await pool.query("SELECT 1 FROM tlengan WHERE Lengan = ?", [
    Lengan,
  ]);
  if (exists.length > 0) {
    throw new Error("Lengan ini sudah ada.");
  }
  // --- AKHIR VALIDASI ---

  await pool.query("INSERT INTO tlengan (Lengan) VALUES (?)", [Lengan]);
  return { message: "Lengan berhasil disimpan." };
};

const remove = async (lengan) => {
  // Validasi: Cek apakah lengan sudah dipakai di tbarangdc
  const [usageRows] = await pool.query(
    "SELECT 1 FROM tbarangdc WHERE brg_lengan = ? LIMIT 1",
    [lengan]
  );
  if (usageRows.length > 0) {
    throw new Error(
      "Lengan ini sudah dipakai di Master Barang dan tidak bisa dihapus."
    );
  }

  const [deleteResult] = await pool.query(
    "DELETE FROM tlengan WHERE Lengan = ?",
    [lengan]
  );
  if (deleteResult.affectedRows === 0) throw new Error("Data tidak ditemukan.");

  return { message: `Lengan '${lengan}' berhasil dihapus.` };
};

module.exports = { getAll, save, remove };
