const pool = require("../config/database");

const getList = async (filters, user) => {
  const { page = 1, itemsPerPage = 15, term, startDate, endDate } = filters;
  const offset = (Number(page) - 1) * Number(itemsPerPage);

  // Base Query
  // KOREKSI:
  // 1. Join menggunakan 'AUTO MUTASI' sesuai logic di savePesanan
  // 2. Filter menggunakan i.inv_cab = 'KON' (bukan m.mso_ke)
  // 3. Filter i.inv_is_marketplace = 'Y' untuk memastikan ini pesanan online

  let baseQuery = `
    FROM tmutasistok_hdr m
    LEFT JOIN tinv_hdr i ON i.inv_ket = CONCAT('LINK MUTASI ', m.mso_nomor)
    WHERE (
        m.mso_jenis IN ('SHOPEE', 'TOKOPEDIA', 'TIKTOK SHOP', 'LAZADA', 'WEBSITE') 
        OR m.mso_ket LIKE 'PESANAN:%'
    )
  `;

  const params = [];

  // Filter Cabang Asal (Opsional: Agar toko hanya melihat mutasi dari tokonya sendiri)
  // Jika user adalah KON atau KDC (Pusat), mungkin bisa lihat semua.
  if (user.cabang !== "KON" && user.cabang !== "KDC") {
    baseQuery += ` AND m.mso_cab = ?`;
    params.push(user.cabang);
  }

  // Filter Tanggal
  if (startDate && endDate) {
    baseQuery += ` AND m.mso_tanggal BETWEEN ? AND ?`;
    params.push(startDate, endDate);
  }

  // Filter Pencarian
  if (term) {
    baseQuery += ` AND (
      m.mso_nomor LIKE ? OR 
      i.inv_nomor LIKE ? OR 
      m.mso_ket LIKE ? OR
      m.mso_jenis LIKE ?
    )`;
    const search = `%${term}%`;
    params.push(search, search, search, search);
  }

  // 1. Hitung Total
  const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;
  const [countRows] = await pool.query(countQuery, params);
  const total = countRows[0].total;

  // 2. Ambil Data
  // [FIX] Select Data
  const dataQuery = `
    SELECT 
      m.mso_nomor,
      m.mso_tanggal,
      m.mso_cab AS mso_dari,
      m.mso_jenis,
      m.mso_ket,
      m.user_create,
      
      -- Jika belum ada invoice, tampilkan status/strip
      IFNULL(i.inv_nomor, 'BELUM DIPROSES') AS inv_nomor,
      IFNULL(i.inv_bayar, 0) AS total_penjualan,
      i.inv_mp_resi AS no_resi,
      i.inv_mp_nomor_pesanan AS no_pesanan
      
    ${baseQuery}
    ORDER BY m.mso_tanggal DESC, m.mso_nomor DESC
    LIMIT ? OFFSET ?
  `;

  params.push(Number(itemsPerPage), Number(offset));
  const [rows] = await pool.query(dataQuery, params);

  return { items: rows, total };
};

module.exports = { getList };
