const pool = require("../config/database");

const getKomplainList = async (filters, user) => {
  // Tangkap parameter cabang dari frontend
  const {
    term,
    status,
    cabang,
    startDate,
    endDate,
    page = 1,
    itemsPerPage = 15,
  } = filters;
  const limit = parseInt(itemsPerPage);
  const offset = (parseInt(page) - 1) * limit;
  const searchTerm = `%${term || ""}%`;

  let baseQuery = `
    FROM tkomplain_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.cmp_cus_kode
    WHERE 1=1
  `;
  const params = [];

  // --- [BARU] FILTER TANGGAL ---
  if (startDate && endDate) {
    baseQuery += ` AND DATE(h.cmp_tanggal) BETWEEN ? AND ?`;
    params.push(startDate, endDate);
  }

  // --- LOGIKA FILTER CABANG ---
  if (user.cabang === "KDC") {
    // Jika user KDC dan memilih cabang spesifik di dropdown
    if (cabang && cabang !== "ALL") {
      baseQuery += ` AND h.cmp_cab = ?`;
      params.push(cabang);
    }
  } else {
    // Jika user TOKO, paksa hanya bisa lihat cabangnya sendiri
    baseQuery += ` AND h.cmp_cab = ?`;
    params.push(user.cabang);
  }

  // Filter Status
  if (status && status !== "ALL") {
    baseQuery += ` AND h.cmp_status = ?`;
    params.push(status);
  }

  // Filter Pencarian
  if (term) {
    baseQuery += ` AND (h.cmp_nomor LIKE ? OR c.cus_nama LIKE ? OR h.cmp_ref_nomor LIKE ?)`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  const countQuery = `SELECT COUNT(*) AS total ${baseQuery}`;
  const [countRows] = await pool.query(countQuery, params);

  const dataQuery = `
    SELECT 
      h.cmp_nomor, 
      h.cmp_tanggal, 
      h.cmp_cus_kode, 
      c.cus_nama, 
      h.cmp_ref_jenis, 
      h.cmp_ref_nomor, 
      h.cmp_kategori, 
      h.cmp_status, 
      h.date_create
    ${baseQuery}
    ORDER BY h.cmp_tanggal DESC, h.date_create DESC
  `;
  // [PERBAIKAN] Kloning params untuk query data agar tidak merusak countQuery
  const dataParams = [...params];
  let finalDataQuery = dataQuery;

  if (limit !== -1) {
    finalDataQuery += ` LIMIT ? OFFSET ?`;
    dataParams.push(limit, offset);
  }

  const [items] = await pool.query(finalDataQuery, dataParams);

  return { items, total: countRows[0].total };
};

module.exports = { getKomplainList };
