const pool = require("../config/database");

/**
 * Fungsi pencarian gudang/store yang fleksibel.
 * @param {object} filters - Objek filter.
 * @param {string} filters.term - Kata kunci pencarian.
 * @param {number} filters.page - Halaman saat ini.
 * @param {number} filters.itemsPerPage - Item per halaman.
 * @param {string} filters.excludeBranch - Kode cabang yang akan dikecualikan.
 * @param {boolean} filters.onlyDc - Jika true, hanya tampilkan gudang DC.
 */
const searchWarehouses = async (filters) => {
  const {
    term,
    page: pageStr,
    itemsPerPage: itemsPerPageStr,
    excludeBranch,
    onlyDc,
  } = filters;

  const page = parseInt(pageStr, 10) || 1;
  const itemsPerPage = parseInt(itemsPerPageStr, 10) || 10;
  const offset = (page - 1) * itemsPerPage;
  const searchTerm = `%${term || ""}%`;

  let whereConditions = [];
  let params = [];

  // Terapkan filter utama berdasarkan parameter
  if (onlyDc) {
    // --- Logika untuk Koreksi Stok (hanya DC) ---
    // Sesuai Delphi: WHERE gdg_dc <> 0
    whereConditions.push("gdg_dc <> 0");
  } else if (excludeBranch) {
    // --- Logika untuk Mutasi Kirim (exclude cabang sendiri) ---
    // Sesuai Delphi: WHERE gdg_dc = 0 AND gdg_kode <> ?
    whereConditions.push("gdg_dc = 0");
    whereConditions.push("gdg_kode <> ?");
    params.push(excludeBranch);
  } else {
    // --- Logika Default (untuk Surat Jalan, dll.) ---
    // Sesuai Delphi: gdg_dc = 0 ATAU gdg_dc = 3
    whereConditions.push("(gdg_dc = 0 OR gdg_dc = 3)");
  }

  // Tambahkan filter pencarian (term)
  if (term) {
    whereConditions.push(`(gdg_kode LIKE ? OR gdg_nama LIKE ?)`);
    params.push(searchTerm, searchTerm);
  }

  const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

  const countQuery = `SELECT COUNT(*) as total FROM tgudang ${whereClause}`;
  const [countRows] = await pool.query(countQuery, params);
  const total = countRows[0].total;

  const dataQuery = `
        SELECT gdg_kode AS kode, gdg_nama AS nama 
        FROM tgudang 
        ${whereClause}
        ORDER BY gdg_kode
        LIMIT ? OFFSET ?;
    `;
  const dataParams = [...params, itemsPerPage, offset];
  const [items] = await pool.query(dataQuery, dataParams);

  return { items, total };
};

// Fungsi ini tetap sama, tidak diubah
const getBranchOptions = async (userCabang) => {
  let query = "";
  let params = [];
  if (userCabang === "KDC") {
    query =
      'SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode NOT IN ("KBS", "KPS") ORDER BY gdg_kode';
  } else {
    query =
      "SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode = ?";
    params.push(userCabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

// Fungsi ini juga tetap sama, tidak diubah
const getSoDtfBranchOptions = async (userCabang) => {
  let query = "";
  let params = [];
  if (userCabang === "KDC") {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc = 0 ORDER BY gdg_kode";
  } else {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?";
    params.push(userCabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

const getById = async (kode) => {
    const query = "SELECT gdg_kode AS kode, gdg_nama AS nama FROM retail.tgudang WHERE gdg_kode = ?";
    const [rows] = await pool.query(query, [kode]);
    // Kembalikan null jika tidak ditemukan agar frontend bisa menangani
    return rows.length > 0 ? rows[0] : null; 
};

module.exports = {
  searchWarehouses,
  getBranchOptions,
  getSoDtfBranchOptions,
  getById,
};
