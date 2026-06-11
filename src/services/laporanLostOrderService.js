const pool = require("../config/database");

/**
 * Mengambil data laporan lost order berdasarkan filter.
 */
const getLostOrderReport = async (filters, user) => {
  const { startDate, endDate, cabang, keyword } = filters;
  let whereClauses = ["DATE(lo.date_create) BETWEEN ? AND ?"];
  let params = [startDate, endDate];

  if (user.cabang !== "KDC") {
    whereClauses.push("lo.lo_cabang = ?");
    params.push(user.cabang);
  } else if (cabang && cabang !== "ALL") {
    whereClauses.push("lo.lo_cabang = ?");
    params.push(cabang);
  }

  if (keyword && keyword.trim() !== "") {
    const term = `%${keyword.trim()}%`;
    whereClauses.push(
      "(lo.lo_produk_nama LIKE ? OR lo.lo_customer_nama LIKE ? OR lo.lo_alasan LIKE ?)",
    );
    params.push(term, term, term);
  }

  const query = `
    SELECT lo.lo_id AS id, lo.date_create AS tanggal, lo.lo_cabang AS kode_cabang,
           IFNULL(g.gdg_nama, lo.lo_cabang) AS nama_cabang, IFNULL(lo.lo_customer_nama, '-') AS customer_nama,
           IFNULL(lo.lo_customer_telp, '-') AS customer_telp, lo.lo_produk_nama AS produk_nama,
           lo.lo_ukuran AS ukuran, lo.lo_qty AS qty, IFNULL(lo.lo_alasan, '-') AS alasan,
           IFNULL(lo.lo_catatan, '-') AS catatan, lo.user_create
    FROM tlost_order lo
    LEFT JOIN tgudang g ON g.gdg_kode = lo.lo_cabang
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY lo.date_create DESC;
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * [BARU] Mengambil data laporan sukses kunjungan dari tabel tracking harian
 */
const getKunjunganReport = async (filters, user) => {
  const { startDate, endDate, cabang, keyword } = filters;
  let whereClauses = ["kc.tanggal BETWEEN ? AND ?"];
  let params = [startDate, endDate];

  if (user.cabang !== "KDC") {
    whereClauses.push("kc.cabang = ?");
    params.push(user.cabang);
  } else if (cabang && cabang !== "ALL") {
    whereClauses.push("kc.cabang = ?");
    params.push(cabang);
  }

  if (keyword && keyword.trim() !== "") {
    const term = `%${keyword.trim()}%`;
    whereClauses.push(
      "(kc.cus_kode LIKE ? OR c.cus_nama LIKE ? OR kc.nomor_dokumen LIKE ?)",
    );
    params.push(term, term, term);
  }

  const query = `
    SELECT kc.id, kc.tanggal, kc.cabang AS kode_cabang, IFNULL(g.gdg_nama, kc.cabang) AS nama_cabang,
           kc.cus_kode AS customer_kode, IFNULL(c.cus_nama, 'Umum/Retail') AS customer_nama,
           kc.tipe_kunjungan, kc.sumber_dokumen, kc.nomor_dokumen, kc.user_create, kc.created_at
    FROM tkunjungan_customer kc
    LEFT JOIN tgudang g ON g.gdg_kode = kc.cabang
    LEFT JOIN tcustomer c ON c.cus_kode = kc.cus_kode
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY kc.created_at DESC;
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getLostOrderReport,
  getKunjunganReport,
};
