const pool = require("../config/database");

/**
 * Membuat klausa WHERE dan parameter berdasarkan filter.
 */
const buildWhereClause = (filters, user) => {
  const { cabang } = filters;
  let where =
    'WHERE m.mst_aktif="Y" AND (m.mst_stok_in - m.mst_stok_out) <> 0 ';
  const params = [];

  if (user.cabang !== "KDC") {
    // Jika bukan KDC, paksa filter ke cabang user
    where += "AND m.mst_cab = ? ";
    params.push(user.cabang);
  } else if (cabang && cabang !== "ALL") {
    // Jika KDC, gunakan filter dropdown
    where += "AND m.mst_cab = ? ";
    params.push(cabang);
  }

  return { where, params };
};

/**
 * Mengambil data Laporan HPP 0.
 * Menerjemahkan TfrmRptHpp0.btnRefreshClick
 */
const getList = async (filters, user) => {
  const { page = 1, itemsPerPage = 10 } = filters;
  const offset = (page - 1) * itemsPerPage;

  const { where, params } = buildWhereClause(filters, user);

  // Query dasar yang sama dengan Delphi, digabungkan
  const baseQuery = `
        FROM (
            SELECT 
                m.mst_cab AS Cabang,
                m.mst_brg_kode AS Kode, 
                b.brgd_barcode AS Barcode,
                TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS Nama,
                m.mst_ukuran AS Ukuran, 
                (m.mst_stok_in - m.mst_stok_out) AS Stok, 
                b.brgd_hpp AS Hpp
            FROM tmasterstok m
            LEFT JOIN tbarangdc a ON a.brg_kode = m.mst_brg_kode
            LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = m.mst_brg_kode AND b.brgd_ukuran = m.mst_ukuran
            ${where}
            GROUP BY m.mst_cab, m.mst_brg_kode, m.mst_ukuran
        ) X
        WHERE X.Hpp < 100
    `;

  // Query untuk mengambil total item (untuk paginasi)
  const countQuery = `SELECT COUNT(*) AS total ${baseQuery}`;
  const [countRows] = await pool.query(countQuery, params);
  const totalItems = countRows[0].total;

  // Query untuk mengambil data dengan paginasi
  const dataQuery = `
        SELECT X.Kode, X.Barcode, X.Nama, X.Ukuran, X.Stok, X.Hpp
        ${baseQuery}
        ORDER BY X.Kode, RIGHT(X.Barcode, 3)
        LIMIT ? OFFSET ?
    `;

  // Tambahkan parameter pagination
  const dataParams = [
    ...params,
    itemsPerPage === -1 ? totalItems : parseInt(itemsPerPage, 10), // Jika itemsPerPage -1, ambil semua
    offset,
  ];

  const [rows] = await pool.query(dataQuery, dataParams);

  return { items: rows, totalItems };
};

/**
 * Mengambil opsi filter cabang.
 * Menerjemahkan TfrmRptHpp0.FormCreate
 */
const getCabangOptions = async (user) => {
  let query;
  const params = [];
  if (user.cabang === "KDC") {
    // KDC bisa melihat semua cabang store
    query =
      "SELECT 'ALL' AS kode, 'SEMUA CABANG' AS nama UNION ALL SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc = 0 ORDER BY kode";
  } else {
    // Cabang biasa hanya melihat cabangnya sendiri
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?";
    params.push(user.cabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getCabangOptions,
};
