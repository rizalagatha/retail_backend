const pool = require("../config/database");

/**
 * 1. Membuat Catatan Lost Order Baru
 */
const createLostOrder = async (payload, user) => {
  const {
    customerNama,
    customerTelp,
    produkNama,
    ukuran,
    qty,
    alasan,
    catatan,
  } = payload;

  const query = `
      INSERT INTO tlost_order 
      (lo_cabang, lo_customer_nama, lo_customer_telp, lo_produk_nama, lo_ukuran, lo_qty, lo_alasan, lo_catatan, user_create, date_create) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

  const values = [
    user.cabang,
    customerNama || null,
    customerTelp || null,
    produkNama,
    ukuran,
    parseInt(qty, 10),
    alasan || null,
    catatan || null,
    user.kode,
  ];

  const [result] = await pool.query(query, values);
  return result;
};

/**
 * 2. Mengambil Riwayat Lost Order (Untuk Dashboard / Rekap)
 */
const getLostOrders = async (filters, user) => {
  const { startDate, endDate, page = 1, limit = 20 } = filters;

  let baseQuery = `FROM tlost_order WHERE 1=1`;
  let params = [];

  // Filter by cabang jika bukan user pusat/KDC
  if (user.cabang !== "KDC") {
    baseQuery += ` AND lo_cabang = ?`;
    params.push(user.cabang);
  }

  // Filter tanggal jika ada
  if (startDate && endDate) {
    baseQuery += ` AND DATE(date_create) BETWEEN ? AND ?`; // Asumsi mencari berdasarkan date_create
    params.push(startDate, endDate);
  }

  // Ambil total data
  const [countRows] = await pool.query(
    `SELECT COUNT(*) as total ${baseQuery}`,
    params,
  );
  const totalItems = countRows[0].total;

  // Ambil data dengan paginasi
  const offset = (page - 1) * limit;
  const dataQuery = `
      SELECT 
        lo_id, date_create AS lo_tanggal, lo_cabang, lo_customer_nama, lo_customer_telp,
        lo_produk_nama, lo_ukuran, lo_qty, lo_alasan, lo_catatan, user_create
      ${baseQuery}
      ORDER BY date_create DESC
      LIMIT ? OFFSET ?
    `;

  params.push(parseInt(limit), parseInt(offset));
  const [rows] = await pool.query(dataQuery, params);

  return {
    data: rows,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalItems / limit),
      totalItems: totalItems,
    },
  };
};

module.exports = {
  createLostOrder,
  getLostOrders,
};
