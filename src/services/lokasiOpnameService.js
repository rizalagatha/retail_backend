const pool = require("../config/database");
const { format } = require("date-fns");

const getList = async (filters) => {
  const { cabang, jenis } = filters;

  let query = `
    SELECT 
      lo.lo_idrec, 
      lo.lo_cab, 
      lo.lo_lokasi, 
      lo.lo_jenis_nama, 
      lo.user_create, 
      lo.date_create,
      g.gdg_nama as cab_nama
    FROM tlokasi_opname lo
    LEFT JOIN tgudang g ON lo.lo_cab = g.gdg_kode
    WHERE lo.lo_cab = ?
  `;

  const params = [cabang];

  if (jenis && jenis !== "ALL" && jenis !== "SEMUA JENIS") {
    query += ` AND lo.lo_jenis_nama = ?`;
    params.push(jenis);
  }

  // --- PERBAIKAN SORTING DI SINI ---
  // Kita urutkan berdasarkan panjang teks dulu, baru teksnya.
  // Hasilnya: BX1 (3 char) akan muncul sebelum BX10 (4 char).
  query += ` ORDER BY LENGTH(lo.lo_lokasi) ASC, lo.lo_lokasi ASC`;

  const [rows] = await pool.query(query, params);
  return rows;
};

const getMasterOptions = async () => {
  const [rows] = await pool.query(
    "SELECT ml_jenis as jenis, ml_kode as kode, ml_status as status FROM tmaster_lokasi_opname",
  );
  return rows;
};

const bulkGenerate = async (payload) => {
  const { cabang, locations, user, jenisNama } = payload;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const timestamp = require("date-fns").format(
      new Date(),
      "yyyyMMddHHmmssSSS",
    );

    // Pastikan kolom lo_jenis_nama ada dalam list kolom
    const query = `
      INSERT IGNORE INTO tlokasi_opname (lo_idrec, lo_cab, lo_lokasi, lo_jenis_nama, user_create)
      VALUES ?
    `;

    const values = locations.map((loc, index) => [
      `${cabang}LO${timestamp}${index}`,
      cabang,
      loc.toUpperCase(),
      jenisNama, // Data ini yang akan mengisi kolom lo_jenis_nama
      user,
    ]);

    await connection.query(query, [values]);
    await connection.commit();
    return { message: `${locations.length} lokasi berhasil didaftarkan.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const deleteLocation = async (idrec) => {
  await pool.query("DELETE FROM tlokasi_opname WHERE lo_idrec = ?", [idrec]);
  return { message: "Lokasi berhasil dihapus." };
};

module.exports = { getList, getMasterOptions, bulkGenerate, deleteLocation };
