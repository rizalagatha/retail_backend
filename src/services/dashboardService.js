const pool = require("../config/database");
const { startOfMonth, endOfMonth, format, subDays } = require("date-fns");

// Fungsi untuk mengambil statistik penjualan & transaksi hari ini
const getTodayStats = async (user) => {
  const today = format(new Date(), "yyyy-MM-dd");
  let branchFilter = "AND LEFT(h.inv_nomor, 3) = ?";
  let params = [today, today, user.cabang];

  if (user.cabang === "KDC") {
    branchFilter = ""; // KDC bisa melihat semua
    params = [today, today];
  }

  const query = `
        SELECT
            COUNT(DISTINCT h.inv_nomor) AS todayTransactions,
            SUM(
                (SELECT SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) FROM tinv_dtl dd WHERE dd.invd_inv_nomor = h.inv_nomor) - h.inv_disc + 
                (h.inv_ppn / 100 * ((SELECT SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) FROM tinv_dtl dd WHERE dd.invd_inv_nomor = h.inv_nomor) - h.inv_disc))
            ) AS todaySales
        FROM tinv_hdr h
        WHERE h.inv_sts_pro = 0 AND h.inv_tanggal BETWEEN ? AND ?
        ${branchFilter};
    `;

  const [rows] = await pool.query(query, params);
  return rows[0];
};

// Fungsi untuk mengambil data grafik penjualan
const getSalesChartData = async (filters, user) => {
  // 1. Ambil 'groupBy' dari filters, default-nya 'day'
  const { startDate, endDate, cabang, groupBy = "day" } = filters;
  let params = [startDate, endDate];
  let branchFilter = "";

  // Logika filter cabang tidak berubah
  if (user.cabang === "KDC" && cabang && cabang !== "ALL") {
    branchFilter = "AND LEFT(h.inv_nomor, 3) = ?";
    params.push(cabang);
  } else if (user.cabang !== "KDC") {
    branchFilter = "AND LEFT(h.inv_nomor, 3) = ?";
    params.push(user.cabang);
  }

  // 2. Tentukan format tanggal dan klausa GROUP BY secara dinamis
  let dateSelect, groupByClause;
  switch (groupBy) {
    case "week":
      dateSelect =
        "STR_TO_DATE(CONCAT(YEAR(h.inv_tanggal), WEEK(h.inv_tanggal, 1), ' Monday'), '%X%V %W') AS tanggal";
      groupByClause = "GROUP BY YEAR(h.inv_tanggal), WEEK(h.inv_tanggal, 1)";
      break;
    case "month":
      dateSelect = "DATE_FORMAT(h.inv_tanggal, '%Y-%m-01') AS tanggal"; // Grup per bulan
      groupByClause = "GROUP BY YEAR(h.inv_tanggal), MONTH(h.inv_tanggal)";
      break;
    default: // 'day'
      dateSelect = "DATE(h.inv_tanggal) AS tanggal"; // Grup per hari
      groupByClause = "GROUP BY DATE(h.inv_tanggal)";
      break;
  }

  const query = `
        SELECT 
            ${dateSelect},
            SUM(
                 (SELECT SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) FROM tinv_dtl dd WHERE dd.invd_inv_nomor = h.inv_nomor) - h.inv_disc + 
                (h.inv_ppn / 100 * ((SELECT SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) FROM tinv_dtl dd WHERE dd.invd_inv_nomor = h.inv_nomor) - h.inv_disc))
            ) AS total
        FROM tinv_hdr h
        WHERE h.inv_sts_pro = 0 AND h.inv_tanggal BETWEEN ? AND ?
        ${branchFilter}
        ${groupByClause}
        ORDER BY tanggal;
    `;
  const [rows] = await pool.query(query, params);
  return rows;
};

const getCabangOptions = async (user) => {
  let query = "";
  let params = [];
  if (user.cabang === "KDC") {
    query = `
            SELECT 'ALL' AS kode, 'Semua Cabang' AS nama
            UNION ALL
            SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang ORDER BY kode;
        `;
  } else {
    query = `SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?`;
    params.push(user.cabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

const getRecentTransactions = async (user) => {
  let branchFilter = "AND LEFT(h.inv_nomor, 3) = ?";
  let params = [user.cabang];

  if (user.cabang === "KDC") {
    branchFilter = ""; // KDC bisa melihat semua
    params = [];
  }

  // Query untuk mengambil 5 invoice terakhir
  const query = `
        SELECT 
            h.inv_nomor AS id,
            c.cus_nama AS customer,
            (
                (SELECT SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) FROM tinv_dtl dd WHERE dd.invd_inv_nomor = h.inv_nomor) - h.inv_disc + 
                (h.inv_ppn / 100 * ((SELECT SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) FROM tinv_dtl dd WHERE dd.invd_inv_nomor = h.inv_nomor) - h.inv_disc))
            ) AS amount,
            DATE_FORMAT(h.date_create, '%H:%i') AS time
        FROM tinv_hdr h
        LEFT JOIN tcustomer c ON h.inv_cus_kode = c.cus_kode
        WHERE h.inv_sts_pro = 0 ${branchFilter}
        ORDER BY h.date_create DESC
        LIMIT 5;
    `;

  const [rows] = await pool.query(query, params);
  return rows;
};

// Di dalam file services/dashboardService.js

const getPendingActions = async (user) => {
  const oneMonthAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

  let branchFilterClause = "AND LEFT(nomor, 3) = ?";
  let params = [user.cabang];
  if (user.cabang === "KDC") {
    branchFilterClause = "";
    params = [];
  }

  const dateParams = [oneMonthAgo, ...params];

  // Query untuk Penawaran Open
  const penawaranQuery = `
        SELECT COUNT(*) as count 
        FROM tpenawaran_hdr h
        WHERE h.pen_tanggal >= ? 
          AND NOT EXISTS (SELECT 1 FROM tso_hdr so WHERE so.so_pen_nomor = h.pen_nomor)
          AND (h.pen_alasan IS NULL OR h.pen_alasan = '')
          ${branchFilterClause.replace("nomor", "h.pen_nomor")};
    `;

  // Query untuk Pengajuan Harga pending
  const pengajuanQuery = `
        SELECT COUNT(*) as count 
        FROM tpengajuanharga h
        WHERE h.ph_tanggal >= ?
          AND (h.ph_apv IS NULL OR h.ph_apv = '')
        ${branchFilterClause.replace("nomor", "h.ph_nomor")};
    `;

  // Query untuk SO yang masih open
  const soOpenQuery = `
        SELECT COUNT(*) as count FROM (
            SELECT 
                (CASE
                    WHEN y.sts = 2 THEN "DICLOSE"
                    WHEN y.StatusKirim = "TERKIRIM" THEN "CLOSE"
                    WHEN y.StatusKirim = "BELUM" AND y.keluar = 0 AND y.minta = "" AND y.pesan = 0 THEN "OPEN"
                    ELSE "PROSES"
                END) AS StatusFinal
            FROM (
                SELECT x.*,
                    IF(x.QtyInv = 0, "BELUM", IF(x.QtyInv >= x.QtySO, "TERKIRIM", "SEBAGIAN")) AS StatusKirim,
                    IFNULL((SELECT SUM(m.mst_stok_out) FROM tmasterstok m WHERE m.mst_noreferensi IN (SELECT o.mo_nomor FROM tmutasiout_hdr o WHERE o.mo_so_nomor = x.Nomor)), 0) AS keluar,
                    IFNULL((SELECT m.mt_nomor FROM tmintabarang_hdr m WHERE m.mt_so = x.Nomor LIMIT 1), "") AS minta,
                    IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstokso m WHERE m.mst_aktif = "Y" AND m.mst_nomor_so = x.Nomor), 0) AS pesan
                FROM (
                    SELECT 
                        h.so_nomor AS Nomor, h.so_close AS sts,
                        IFNULL((SELECT SUM(dd.sod_jumlah) FROM tso_dtl dd WHERE dd.sod_so_nomor = h.so_nomor), 0) AS QtySO,
                        IFNULL((SELECT SUM(dd.invd_jumlah) FROM tinv_hdr hh JOIN tinv_dtl dd ON dd.invd_inv_nomor = hh.inv_nomor WHERE hh.inv_sts_pro = 0 AND hh.inv_nomor_so = h.so_nomor), 0) AS QtyInv
                    FROM tso_hdr h
                    WHERE h.so_tanggal >= ? AND h.so_aktif = 'Y' ${branchFilterClause.replace(
                      "nomor",
                      "h.so_nomor"
                    )}
                ) x
            ) y
        ) z
        WHERE z.StatusFinal = 'OPEN';
    `;

  // Query untuk Invoice yang belum lunas
  const invoiceQuery = `
        SELECT COUNT(*) AS count
        FROM tinv_hdr h
        LEFT JOIN (
            SELECT pd_ph_nomor, SUM(pd_debet) AS debet, SUM(pd_kredit) AS kredit 
            FROM tpiutang_dtl GROUP BY pd_ph_nomor
        ) v ON v.pd_ph_nomor = (SELECT ph_nomor FROM tpiutang_hdr u WHERE u.ph_inv_nomor = h.inv_nomor LIMIT 1)
        WHERE h.inv_tanggal >= ? 
          AND h.inv_sts_pro = 0 AND (v.debet - v.kredit) > 0
        ${branchFilterClause.replace("nomor", "h.inv_nomor")};
    `;

  // Query untuk SO DTF Open
  const soDtfOpenQuery = `
        SELECT COUNT(*) as count 
        FROM tsodtf_hdr h
        WHERE h.sd_stok = "" AND h.sd_tanggal >= ? 
          AND NOT EXISTS (SELECT 1 FROM tinv_dtl dd WHERE dd.invd_sd_nomor = h.sd_nomor)
          ${branchFilterClause.replace("nomor", "h.sd_nomor")};
    `;

  // Jalankan semua query
  const [
    [penawaranResult],
    [pengajuanResult],
    [soOpenResult],
    [invoiceResult],
    [soDtfOpenResult],
  ] = await Promise.all([
    pool.query(penawaranQuery, dateParams),
    pool.query(pengajuanQuery, dateParams),
    pool.query(soOpenQuery, dateParams),
    pool.query(invoiceQuery, dateParams),
    pool.query(soDtfOpenQuery, dateParams),
  ]);

  return {
    penawaran_open: penawaranResult[0].count,
    pengajuan_harga_pending: pengajuanResult[0].count,
    so_open: soOpenResult[0].count,
    invoice_belum_lunas: invoiceResult[0].count,
    so_dtf_open: soDtfOpenResult[0].count,
  };
};

const getTopSellingProducts = async (user) => {
  const startDate = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const endDate = format(endOfMonth(new Date()), "yyyy-MM-dd");

  let branchFilter = "AND LEFT(h.inv_nomor, 3) = ?";
  let params = [startDate, endDate, user.cabang];

  if (user.cabang === "KDC") {
    branchFilter = "";
    params = [startDate, endDate];
  }

  // Query ini mengambil 10 produk terlaris berdasarkan kuantitas
  const query = `
        SELECT 
            d.invd_kode AS KODE,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS NAMA,
            SUM(d.invd_jumlah) AS TOTAL
        FROM tinv_hdr h
        INNER JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
        INNER JOIN tbarangdc a ON a.brg_kode = d.invd_kode
        WHERE h.inv_sts_pro = 0 
          AND h.inv_tanggal BETWEEN ? AND ?
          AND a.brg_logstok = "Y"
          ${branchFilter}
        GROUP BY d.invd_kode, NAMA
        ORDER BY TOTAL DESC
        LIMIT 10;
    `;

  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getTodayStats,
  getSalesChartData,
  getCabangOptions,
  getRecentTransactions,
  getPendingActions,
  getTopSellingProducts,
};
