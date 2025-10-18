const pool = require("../config/database");
const { format } = require("date-fns");

/**
 * Mengambil data mentah penjualan untuk laporan pivot.
 */
const getSalesData = async (filters, user) => {
  const { startDate, endDate } = filters;
  let params = [startDate, endDate];
  let branchFilter = "";

  if (user.cabang !== "KDC") {
    branchFilter = "AND LEFT(h.inv_nomor, 3) = ?";
    params.push(user.cabang);
  }

  // Query ini adalah terjemahan dari btnTampilClick di Delphi
  const query = `
        SELECT 
            x.Nomor, x.Bulan, x.Tahun, x.Tanggal, x.KdCus, x.Customer, x.Level_, 
            x.Kode, x.Nama, x.Ukuran, x.Qty,
            (x.rp - (x.inv_disc / x.item)) AS Nominal,
            x.Store, x.NamaStore, x.KtgProduk, x.KtgBarang, x.JenisKain, x.Warna
        FROM (
            SELECT 
                h.inv_nomor AS Nomor, MONTH(h.inv_tanggal) AS Bulan, YEAR(h.inv_tanggal) AS Tahun, 
                h.inv_tanggal AS Tanggal, h.inv_cus_kode AS KdCus,
                c.cus_nama AS Customer, l.level_nama AS Level_, a.brg_kode AS Kode, 
                TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS Nama, 
                d.invd_ukuran AS Ukuran, d.invd_jumlah AS Qty,
                ((d.invd_harga - d.invd_diskon) * d.invd_jumlah) AS rp, h.inv_disc,
                (SELECT COUNT(*) FROM tinv_dtl i WHERE i.invd_inv_nomor = d.invd_inv_nomor) AS item,
                LEFT(h.inv_nomor, 3) AS Store, g.gdg_nama AS NamaStore, 
                a.brg_ktgp AS KtgProduk, a.brg_ktg AS KtgBarang, a.brg_jeniskain AS JenisKain, 
                IF(a.brg_ktg <> "", "", a.brg_warna) AS Warna
            FROM tinv_dtl d
            INNER JOIN tinv_hdr h ON d.invd_inv_nomor = h.inv_nomor
            INNER JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
            LEFT JOIN tcustomer_level l ON l.level_kode = h.inv_cus_level
            LEFT JOIN tbarangdc a ON d.invd_kode = a.brg_kode
            LEFT JOIN tgudang g ON g.gdg_kode = LEFT(h.inv_nomor, 3)
            WHERE h.inv_sts_pro = 0 AND h.inv_tanggal BETWEEN ? AND ?
            ${branchFilter}
        ) x
    `;

  const [rows] = await pool.query(query, params);
  return rows;
};

const getChartData = async (filters, user) => {
  // 1. Ambil semua filter yang relevan
  const { startDate, endDate, cabang, level, kategori } = filters;

  let params = [startDate, endDate];
  let whereClauses = [];

  // 2. Terapkan semua logika filter, sama seperti di getSalesData
  if (user.cabang !== "KDC") {
    whereClauses.push("LEFT(h.inv_nomor, 3) = ?");
    params.push(user.cabang);
  } else if (cabang && cabang !== "ALL") {
    whereClauses.push("LEFT(h.inv_nomor, 3) = ?");
    params.push(cabang);
  }

  if (level && level !== "ALL") {
    whereClauses.push("h.inv_cus_level = ?");
    params.push(level);
  }

  if (kategori && kategori !== "ALL") {
    // Karena perlu filter kategori, kita harus JOIN ke tabel produk
    whereClauses.push("a.brg_ktgp = ?");
  }

  const whereSql =
    whereClauses.length > 0 ? `AND ${whereClauses.join(" AND ")}` : "";

  // 3. Query diperbarui dengan JOIN yang diperlukan untuk filter
  const query = `
        SELECT 
            LEFT(h.inv_nomor, 3) AS store,
            DATE_FORMAT(h.inv_tanggal, '%Y-%m') AS bulan,
            SUM(
                ((d.invd_harga - d.invd_diskon) * d.invd_jumlah) 
                - (h.inv_disc / (SELECT COUNT(*) FROM tinv_dtl i WHERE i.invd_inv_nomor = h.inv_nomor))
            ) AS nominal
        FROM tinv_hdr h
        INNER JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
        INNER JOIN tbarangdc a ON a.brg_kode = d.invd_kode -- Join untuk filter kategori
        WHERE h.inv_sts_pro = 0 AND h.inv_tanggal BETWEEN ? AND ?
        ${whereSql}
        GROUP BY store, bulan
        ORDER BY bulan, store;
    `;

  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getSalesData,
  getChartData,
};
