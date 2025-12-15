const pool = require("../config/database");
const { startOfMonth, endOfMonth, format, subDays } = require("date-fns");

// Fungsi untuk mengambil statistik penjualan & transaksi hari ini
// Fungsi untuk mengambil statistik penjualan, transaksi, DAN QTY hari ini
const getTodayStats = async (user) => {
  const today = format(new Date(), "yyyy-MM-dd");
  let branchFilter = "AND LEFT(h.inv_nomor, 3) = ?";
  let params = [today, today, user.cabang];

  if (user.cabang === "KDC") {
    branchFilter = "";
    params = [today, today];
  }

  // Pola REGEX yang sama untuk mengecualikan Custom Order
  const excludePattern = "^K[0-9]{2}\\.(SD|BR|PM|DP|TG|PL|SB)\\.";

  const query = `
    SELECT
      COUNT(DISTINCT h.inv_nomor) AS todayTransactions,
      
      -- 1. Total Nominal (UANG): Tetap hitung semua (termasuk Jasa & Custom) karena ini omzet
      SUM(
          (SELECT SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) 
           FROM tinv_dtl dd 
           WHERE dd.invd_inv_nomor = h.inv_nomor) 
          - h.inv_disc 
          + (h.inv_ppn / 100 * (
              (SELECT SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) 
               FROM tinv_dtl dd 
               WHERE dd.invd_inv_nomor = h.inv_nomor) - h.inv_disc
            ))
      ) AS todaySales,

      -- 2. Total Qty (BARANG): Filter Jasa & Custom agar yang terhitung hanya Kaos Retail
      IFNULL(SUM(
        (
          SELECT SUM(dd.invd_jumlah) 
          FROM tinv_dtl dd 
          WHERE dd.invd_inv_nomor = h.inv_nomor
            AND dd.invd_kode NOT LIKE 'JASA%'  -- Filter Jasa
            AND dd.invd_kode NOT REGEXP ?      -- Filter Custom SO DTF
        )
      ), 0) AS todayQty

    FROM tinv_hdr h
    WHERE h.inv_sts_pro = 0 
      AND h.inv_tanggal BETWEEN ? AND ?
      ${branchFilter};
  `;

  // Masukkan excludePattern ke dalam params.
  // Urutan params query: [RegexPattern, DateStart, DateEnd, (BranchCode)]
  // Kita perlu memodifikasi array params agar Regex Pattern masuk di posisi yang benar (sebelum branch filter)

  // Karena struktur query di atas kompleks (subquery di dalam select),
  // lebih aman kita masukkan parameter secara eksplisit:

  let finalParams;
  if (user.cabang === "KDC") {
    // Params: [RegexPattern, Today, Today]
    finalParams = [excludePattern, today, today];
  } else {
    // Params: [RegexPattern, Today, Today, Cabang]
    finalParams = [excludePattern, today, today, user.cabang];
  }

  const [rows] = await pool.query(query, finalParams);
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

const getPendingActions = async (user) => {
  // 1. Ubah rentang waktu menjadi "Seluruh Waktu" (misal mulai tahun 2000)
  const allTimeDate = "2020-01-01";

  let branchFilterClause = "AND LEFT(nomor, 3) = ?";
  let params = [user.cabang];

  if (user.cabang === "KDC") {
    branchFilterClause = "";
    params = [];
  }

  // Parameter tanggal (allTimeDate) + Parameter cabang (jika ada)
  const dateParams = [allTimeDate, ...params];

  // --- QUERY 1: Penawaran Open ---
  const penawaranQuery = `
        SELECT COUNT(*) as count 
        FROM tpenawaran_hdr h
        WHERE h.pen_tanggal >= ? 
          AND NOT EXISTS (SELECT 1 FROM tso_hdr so WHERE so.so_pen_nomor = h.pen_nomor)
          AND (h.pen_alasan IS NULL OR h.pen_alasan = '')
          ${branchFilterClause.replace("nomor", "h.pen_nomor")};
    `;

  // --- QUERY 2: Pengajuan Harga Pending ---
  const pengajuanQuery = `
        SELECT COUNT(*) as count 
        FROM tpengajuanharga h
        WHERE h.ph_tanggal >= ?
          AND (h.ph_apv IS NULL OR h.ph_apv = '')
        ${branchFilterClause.replace("nomor", "h.ph_nomor")};
    `;

  // --- QUERY 3: SO Open ---
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
                    WHERE h.so_tanggal >= ? AND h.so_aktif = 'Y' 
                    ${branchFilterClause.replace("nomor", "h.so_nomor")}
                ) x
            ) y
        ) z
        WHERE z.StatusFinal = 'OPEN';
    `;

  // --- QUERY 4: Invoice Sisa Piutang (UPDATED) ---
  // Menggunakan logika saldo debet - kredit > 0
  const invoiceQuery = `
        SELECT COUNT(*) AS count
        FROM tpiutang_hdr u
        LEFT JOIN (
            SELECT pd_ph_nomor, SUM(pd_debet) AS debet, SUM(pd_kredit) AS kredit 
            FROM tpiutang_dtl GROUP BY pd_ph_nomor
        ) v ON v.pd_ph_nomor = u.ph_nomor
        WHERE u.ph_tanggal >= ? 
          AND (IFNULL(v.debet, 0) - IFNULL(v.kredit, 0)) > 100 -- Toleransi pembulatan
          ${branchFilterClause.replace("nomor", "u.ph_inv_nomor")}; 
    `;

  // --- QUERY 5: SO DTF Open ---
  const soDtfOpenQuery = `
        SELECT COUNT(*) as count 
        FROM tsodtf_hdr h
        WHERE h.sd_stok = "" AND h.sd_tanggal >= ? 
          AND NOT EXISTS (SELECT 1 FROM tinv_dtl dd WHERE dd.invd_sd_nomor = h.sd_nomor)
          ${branchFilterClause.replace("nomor", "h.sd_nomor")};
    `;

  // Jalankan semua query secara paralel
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

const getTopSellingProducts = async (user, branchFilter = "") => {
  const startDate = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const endDate = format(endOfMonth(new Date()), "yyyy-MM-dd");

  let targetCabang = null;

  // LOGIKA PENENTUAN CABANG
  if (user.cabang === "KDC") {
    // Jika KDC, cek apakah ada filter dari frontend?
    if (branchFilter && branchFilter !== "ALL") {
      targetCabang = branchFilter;
    }
    // Jika filter kosong atau 'ALL', targetCabang tetap null (ambil semua)
  } else {
    // Jika bukan KDC, paksa pakai cabang user sendiri
    targetCabang = user.cabang;
  }

  // QUERY UTAMA
  let query = `
        SELECT 
            d.invd_kode AS KODE,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS NAMA,
            d.invd_ukuran AS UKURAN, -- Tambahkan Ukuran agar lebih spesifik (opsional, tapi bagus untuk display)
            SUM(d.invd_jumlah) AS TOTAL
        FROM tinv_hdr h
        INNER JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
        INNER JOIN tbarangdc a ON a.brg_kode = d.invd_kode
        WHERE h.inv_sts_pro = 0 
          AND h.inv_tanggal BETWEEN ? AND ?
          AND a.brg_logstok = "Y"
    `;

  const params = [startDate, endDate];

  // TERAPKAN FILTER CABANG JIKA ADA
  if (targetCabang) {
    query += ` AND LEFT(h.inv_nomor, 3) = ? `;
    params.push(targetCabang);
  }

  // GROUPING & SORTING
  query += `
        GROUP BY d.invd_kode, NAMA, d.invd_ukuran
        ORDER BY TOTAL DESC
        LIMIT 10;
    `;

  const [rows] = await pool.query(query, params);
  return rows;
};

const getSalesTargetSummary = async (user) => {
  const tahun = new Date().getFullYear();
  const bulan = new Date().getMonth() + 1;

  let branchFilter = "AND LEFT(h.inv_nomor, 3) = ?";
  let params = [tahun, bulan, user.cabang];

  if (user.cabang === "KDC") {
    branchFilter = ""; // KDC melihat total semua cabang
    params = [tahun, bulan];
  }

  const query = `
        SELECT 
            IFNULL(SUM(
                (SELECT SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) FROM tinv_dtl dd WHERE dd.invd_inv_nomor = h.inv_nomor) - h.inv_disc
            ), 0) AS nominal,
            IFNULL((
                SELECT SUM(t.target_omset) 
                FROM kpi.ttarget_kaosan t 
                WHERE t.tahun = ? AND t.bulan = ? ${
                  user.cabang !== "KDC" ? "AND t.kode_gudang = ?" : ""
                }
            ), 0) AS target
        FROM tinv_hdr h
        WHERE h.inv_sts_pro = 0 AND YEAR(h.inv_tanggal) = ? AND MONTH(h.inv_tanggal) = ?
        ${branchFilter};
    `;

  // Sesuaikan parameter untuk query target
  if (user.cabang !== "KDC") {
    params.unshift(user.cabang);
  }
  params.unshift(bulan);
  params.unshift(tahun);

  const [rows] = await pool.query(query, params);
  return rows[0];
};

/**
 * Mengambil 3 cabang performa terbaik dan terburuk
 * berdasarkan pencapaian target bulan ini.
 */
const getBranchPerformance = async (user) => {
  // Fitur ini hanya relevan untuk KDC (Head Office)
  if (user.cabang !== "KDC") {
    return [];
  }

  const tahun = new Date().getFullYear();
  const bulan = new Date().getMonth() + 1;

  const query = `
        WITH MonthlySales AS (
            SELECT 
                cabang, 
                SUM(nominal) AS nominal 
            FROM v_sales_harian
            WHERE YEAR(tanggal) = ? AND MONTH(tanggal) = ?
            GROUP BY cabang
        ),
        MonthlyTargets AS (
            SELECT 
                kode_gudang AS cabang, 
                SUM(target_omset) AS target
            FROM kpi.ttarget_kaosan
            WHERE tahun = ? AND bulan = ?
            GROUP BY cabang
        ),
        MonthlyReturns AS (
            SELECT 
                LEFT(rh.rj_nomor, 3) AS cabang,
                SUM(rd.rjd_jumlah * (rd.rjd_harga - rd.rjd_diskon)) AS total_retur
            FROM trj_hdr rh
            JOIN trj_dtl rd ON rd.rjd_nomor = rh.rj_nomor
            WHERE YEAR(rh.rj_tanggal) = ? AND MONTH(rh.rj_tanggal) = ?
            GROUP BY LEFT(rh.rj_nomor, 3)
        )
        SELECT 
            g.gdg_kode AS kode_cabang,
            g.gdg_nama AS nama_cabang,
            -- Hitung Netto: Omset Kotor - Retur
            (COALESCE(ms.nominal, 0) - COALESCE(mr.total_retur, 0)) AS nominal,
            COALESCE(mt.target, 0) AS target,
            CASE 
                WHEN COALESCE(mt.target, 0) > 0 THEN 
                    ((COALESCE(ms.nominal, 0) - COALESCE(mr.total_retur, 0)) / mt.target) * 100 
                ELSE 0 
            END AS ach
        FROM tgudang g
        LEFT JOIN MonthlySales ms ON g.gdg_kode = ms.cabang
        LEFT JOIN MonthlyTargets mt ON g.gdg_kode = mt.cabang
        LEFT JOIN MonthlyReturns mr ON g.gdg_kode = mr.cabang
        WHERE 
            (g.gdg_dc = 0 OR g.gdg_kode = 'KPR') -- Tambahkan KPR secara eksplisit
            AND g.gdg_kode <> 'KDC' -- Pastikan KDC tetap tidak ikut
        ORDER BY ach DESC;
    `;

  // Urutan parameter: Sales(2) -> Target(2) -> Returns(2)
  const params = [tahun, bulan, tahun, bulan, tahun, bulan];

  try {
    const [rows] = await pool.query(query, params);
    return rows;
  } catch (error) {
    console.error("Error getBranchPerformance:", error);
    throw error;
  }
};

const getStagnantStockSummary = async (user) => {
  const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

  let branchFilter = "AND m.mst_cab = ?";
  let salesBranchFilter = "AND LEFT(h.inv_nomor, 3) = ?";
  let params = [thirtyDaysAgo];

  if (user.cabang === "KDC") {
    branchFilter = "";
    salesBranchFilter = "";
  } else {
    params.push(user.cabang, user.cabang);
  }

  const query = `
        WITH 
        -- 1. Dapatkan semua barang yang TERJUAL dalam 30 hari terakhir
        SoldRecently AS (
            SELECT DISTINCT
                d.invd_kode,
                d.invd_ukuran
            FROM tinv_hdr h
            JOIN tinv_dtl d ON h.inv_nomor = d.invd_inv_nomor
            WHERE h.inv_sts_pro = 0 AND h.inv_tanggal >= ?
            ${salesBranchFilter}
        ),
        -- 2. Dapatkan stok saat ini
        CurrentStock AS (
            SELECT 
                m.mst_brg_kode,
                m.mst_ukuran,
                SUM(m.mst_stok_in - m.mst_stok_out) AS Stok
            FROM tmasterstok m
            WHERE m.mst_aktif = 'Y' ${branchFilter}
            GROUP BY m.mst_brg_kode, m.mst_ukuran
            HAVING Stok > 0
        )
        -- 3. Hitung total nilai stok yang TIDAK ADA di daftar 'SoldRecently'
        SELECT 
            SUM(cs.Stok * IFNULL(b.brgd_hpp, 0)) AS totalStagnantValue
        FROM CurrentStock cs
        JOIN tbarangdc a ON cs.mst_brg_kode = a.brg_kode
        LEFT JOIN tbarangdc_dtl b ON cs.mst_brg_kode = b.brgd_kode AND cs.mst_ukuran = b.brgd_ukuran
        LEFT JOIN SoldRecently sr ON cs.mst_brg_kode = sr.invd_kode AND cs.mst_ukuran = sr.invd_ukuran
        WHERE 
            a.brg_logstok = 'Y'
            AND sr.invd_kode IS NULL; -- Ini adalah kuncinya: barang yang tidak terjual
    `;

  const [rows] = await pool.query(query, params);
  return rows[0]; // Akan mengembalikan { totalStagnantValue: ... }
};

/**
 * @description Menghitung total sisa piutang.
 */
const getTotalSisaPiutang = async (user) => {
  let branchFilter = "AND LEFT(u.ph_inv_nomor, 3) = ?";
  let params = [user.cabang];

  if (user.cabang === "KDC") {
    branchFilter = "";
    params = [];
  }

  // Ini akan mengubah semua nilai negatif (kelebihan bayar) menjadi 0
  // SEBELUM menjumlahkannya.
  const query = `
    SELECT 
      SUM(GREATEST(0, IFNULL(v.debet, 0) - IFNULL(v.kredit, 0))) AS totalSisaPiutang
    FROM tpiutang_hdr u
    LEFT JOIN (
        SELECT pd_ph_nomor, 
               SUM(pd_debet) AS debet, 
               SUM(pd_kredit) AS kredit 
        FROM tpiutang_dtl 
        GROUP BY pd_ph_nomor
    ) v ON v.pd_ph_nomor = u.ph_nomor
    WHERE 1=1 ${branchFilter};
  `;

  const [rows] = await pool.query(query, params);
  return rows[0];
};

/**
 * @description Menghitung sisa piutang per cabang (HANYA UNTUK KDC).
 */
const getPiutangPerCabang = async (user) => {
  // Fitur ini hanya untuk KDC
  if (user.cabang !== "KDC") {
    return []; // Kembalikan array kosong jika bukan KDC
  }

  // Query ini mengambil total sisa piutang > 0, dikelompokkan per cabang
  const query = `
    SELECT 
      LEFT(u.ph_inv_nomor, 3) AS cabang_kode,
      g.gdg_nama AS cabang_nama,
      SUM(v.debet - v.kredit) AS sisa_piutang
    FROM tpiutang_hdr u
    LEFT JOIN (
        SELECT pd_ph_nomor, 
               SUM(pd_debet) AS debet, 
               SUM(pd_kredit) AS kredit 
        FROM tpiutang_dtl 
        GROUP BY pd_ph_nomor
    ) v ON v.pd_ph_nomor = u.ph_nomor
    LEFT JOIN tgudang g ON g.gdg_kode = LEFT(u.ph_inv_nomor, 3)
    WHERE (v.debet - v.kredit) > 0  -- Hanya ambil yang masih ada sisa
    GROUP BY LEFT(u.ph_inv_nomor, 3), g.gdg_nama
    ORDER BY sisa_piutang DESC;
  `;

  const [rows] = await pool.query(query);
  return rows;
};

/**
 * @description Invoice yang masih punya sisa piutang untuk store tertentu.
 */
const getPiutangPerInvoice = async (user) => {
  // Hanya untuk store, bukan KDC
  if (user.cabang === "KDC") return [];

  const query = `
        SELECT 
            u.ph_inv_nomor AS invoice,
            DATE_FORMAT(h.inv_tanggal, '%Y-%m-%d') AS tanggal,
            IFNULL(v.debet - v.kredit, 0) AS sisa_piutang
        FROM tpiutang_hdr u
        LEFT JOIN (
            SELECT pd_ph_nomor, 
                   SUM(pd_debet) AS debet, 
                   SUM(pd_kredit) AS kredit 
            FROM tpiutang_dtl 
            GROUP BY pd_ph_nomor
        ) v ON v.pd_ph_nomor = u.ph_nomor
        LEFT JOIN tinv_hdr h ON h.inv_nomor = u.ph_inv_nomor
        WHERE LEFT(u.ph_inv_nomor, 3) = ?
          AND (v.debet - v.kredit) > 0
        ORDER BY sisa_piutang DESC;
    `;

  const [rows] = await pool.query(query, [user.cabang]);
  return rows;
};

const getTotalStock = async (user) => {
  let branchFilter = "AND m.mst_cab = ?";
  let params = [];

  if (user.cabang && user.cabang !== "KDC") {
    params.push(user.cabang);
  } else {
    branchFilter = ""; // KDC melihat semua
  }

  // Pola REGEX untuk mengecualikan Custom Order (SO DTF)
  // Mencocokkan: K + 2 angka + titik + (Kode Jenis) + titik
  // Contoh: K01.SD.2023..., K11.BR.2023...
  const excludePattern = "^K[0-9]{2}\\.(SD|BR|PM|DP|TG|PL|SB)\\.";

  // --- 1. Query Total Stok (Semua Waktu) ---
  const totalQuery = `
    SELECT
      SUM(IFNULL(s.stok,0)) AS totalStock
    FROM (
      SELECT m.mst_brg_kode, m.mst_ukuran, SUM(m.mst_stok_in - m.mst_stok_out) AS stok
      FROM (
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif FROM tmasterstok
        UNION ALL
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif FROM tmasterstokso
      ) m
      WHERE m.mst_aktif = 'Y' 
        ${branchFilter}
        AND m.mst_brg_kode NOT LIKE 'JASA%' -- Exclude Jasa
        AND m.mst_brg_kode NOT REGEXP ?     -- Exclude Custom Order (SO DTF)
      GROUP BY m.mst_brg_kode, m.mst_ukuran, m.mst_cab
    ) s;
  `;

  // --- 2. Query Stok In/Out HARI INI (Khusus Store) ---
  let todayIn = 0;
  let todayOut = 0;

  if (user.cabang !== "KDC") {
    const today = format(new Date(), "yyyy-MM-dd");

    const dailyQuery = `
        SELECT 
            SUM(m.mst_stok_in) as stokIn,
            SUM(m.mst_stok_out) as stokOut
        FROM tmasterstok m
        WHERE m.mst_aktif = 'Y' 
          AND m.mst_cab = ? 
          AND m.mst_tanggal = ?
          AND m.mst_brg_kode NOT LIKE 'JASA%' 
          AND m.mst_brg_kode NOT REGEXP ?
    `;

    // Params: Cabang, Tanggal, Regex Pattern
    const [dailyRows] = await pool.query(dailyQuery, [
      user.cabang,
      today,
      excludePattern,
    ]);

    if (dailyRows.length > 0) {
      todayIn = Number(dailyRows[0].stokIn || 0);
      todayOut = Number(dailyRows[0].stokOut || 0);
    }
  }

  // Params untuk Total Query: [Cabang (jika ada), Regex Pattern]
  const totalQueryParams = [...params, excludePattern];
  const [rows] = await pool.query(totalQuery, totalQueryParams);

  return {
    totalStock: Number(rows[0]?.totalStock || 0),
    todayStokIn: todayIn,
    todayStokOut: todayOut,
  };
};

const getStockPerCabang = async () => {
  // Breakdown stok per cabang (untuk KDC hover)
  const query = `
    SELECT
      IFNULL(m.mst_cab, 'UNKNOWN') AS kode_cabang,
      COALESCE(g.gdg_nama, IFNULL(m.mst_cab,'-')) AS nama_cabang,
      SUM(m.stok) AS totalStock
    FROM (
      SELECT mst_brg_kode, mst_ukuran, mst_cab, SUM(mst_stok_in - mst_stok_out) AS stok
      FROM (
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif FROM tmasterstok
        UNION ALL
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif FROM tmasterstokso
      ) t
      WHERE t.mst_aktif = 'Y'
      GROUP BY mst_cab, mst_brg_kode, mst_ukuran
    ) m
    LEFT JOIN tgudang g ON g.gdg_kode = m.mst_cab
    GROUP BY m.mst_cab, g.gdg_nama
    ORDER BY totalStock DESC;
  `;

  const [rows] = await pool.query(query);
  return rows;
};

const getItemSalesTrend = async (user) => {
  // Hanya KDC
  if (user.cabang !== "KDC") return [];

  const query = `
    SELECT 
        a.brg_kode AS kode,
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
        
        -- Penjualan Bulan Ini (Running)
        SUM(CASE WHEN DATE_FORMAT(h.inv_tanggal, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m') 
            THEN d.invd_jumlah ELSE 0 END) AS bulan_ini,
            
        -- Penjualan 1 Bulan Lalu
        SUM(CASE WHEN DATE_FORMAT(h.inv_tanggal, '%Y-%m') = DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m') 
            THEN d.invd_jumlah ELSE 0 END) AS bulan_min_1,

        -- Penjualan 2 Bulan Lalu
        SUM(CASE WHEN DATE_FORMAT(h.inv_tanggal, '%Y-%m') = DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 2 MONTH), '%Y-%m') 
            THEN d.invd_jumlah ELSE 0 END) AS bulan_min_2,

        -- Penjualan 3 Bulan Lalu
        SUM(CASE WHEN DATE_FORMAT(h.inv_tanggal, '%Y-%m') = DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 3 MONTH), '%Y-%m') 
            THEN d.invd_jumlah ELSE 0 END) AS bulan_min_3,

        -- Total 4 Bulan
        SUM(d.invd_jumlah) AS total_qty

    FROM tinv_hdr h
    JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
    JOIN tbarangdc a ON a.brg_kode = d.invd_kode
    WHERE h.inv_sts_pro = 0 
      AND h.inv_tanggal >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 3 MONTH), '%Y-%m-01') -- Ambil sejak 3 bulan lalu
    GROUP BY a.brg_kode, nama
    ORDER BY bulan_ini DESC -- Urutkan dari yang terlaris bulan ini
    LIMIT 10; -- Ambil Top 10 saja agar tidak berat
  `;

  const [rows] = await pool.query(query);
  return rows;
};

const getStockAlerts = async (user) => {
  const cabang = user.cabang;

  // 1. Cek Surat Jalan (SJ) dari DC yang belum diterima
  // Tabel: tdc_sj_hdr
  // Logika: Tujuan = Cabang User, Kolom Terima Kosong
  const querySj = `
    SELECT COUNT(*) AS total 
    FROM tdc_sj_hdr 
    WHERE sj_kecab = ? 
      AND (sj_noterima IS NULL OR sj_noterima = '') 
      -- Filter data 3 bulan terakhir agar performa cepat & data relevan
      AND sj_tanggal >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
  `;

  // 2. Cek Mutasi Kiriman dari Store Lain yang belum diterima
  // Tabel: tmsk_hdr (Mutasi Keluar Header - bagi penerima ini adalah Incoming)
  // Logika: Tujuan (msk_kecab) = Cabang User, Kolom Terima (msk_noterima) Kosong
  const queryMutasi = `
    SELECT COUNT(*) AS total 
    FROM tmsk_hdr 
    WHERE msk_kecab = ? 
      AND (msk_noterima IS NULL OR msk_noterima = '')
      -- Filter data 3 bulan terakhir
      AND msk_tanggal >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
  `;

  // Jalankan Query secara paralel (Promise.all) agar lebih cepat
  const [rowsSj, rowsMutasi] = await Promise.all([
    pool.query(querySj, [cabang]),
    pool.query(queryMutasi, [cabang]),
  ]);

  return {
    sj_pending: rowsSj[0][0].total || 0, // Jumlah SJ Pending
    mutasi_pending: rowsMutasi[0][0].total || 0, // Jumlah Mutasi Pending
  };
};

const getStokKosongReguler = async (
  user,
  searchTerm = "",
  targetCabang = ""
) => {
  // 1. Determine which branch to check
  // Default to the user's own branch
  let branchToCheck = user.cabang;

  // If user is KDC and they selected a specific branch (and it's not empty), use that
  if (user.cabang === "KDC" && targetCabang) {
    branchToCheck = targetCabang;
  }

  const searchPattern = `%${searchTerm}%`;

  const query = `
    SELECT 
        b.brgd_kode AS kode,
        b.brgd_barcode AS barcode,
        TRIM(CONCAT(a.brg_jeniskaos, ' ', a.brg_tipe, ' ', a.brg_lengan, ' ', a.brg_jeniskain, ' ', a.brg_warna)) AS nama_barang,
        b.brgd_ukuran AS ukuran,
        a.brg_ktgp AS kategori,
        
        -- Subquery: Calculate real-time stock for the SPECIFIC branch
        IFNULL((
            SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
            FROM tmasterstok m 
            WHERE m.mst_aktif = 'Y' 
              AND m.mst_cab = ?  -- Use dynamic branch variable
              AND m.mst_brg_kode = b.brgd_kode 
              AND m.mst_ukuran = b.brgd_ukuran
        ), 0) AS stok_akhir

    FROM tbarangdc_dtl b
    INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
    WHERE a.brg_aktif = 0 
      AND a.brg_ktgp = 'REGULER'
      
      -- Search Filter
      AND (
          b.brgd_kode LIKE ? 
          OR b.brgd_barcode LIKE ? 
          OR TRIM(CONCAT(a.brg_jeniskaos, ' ', a.brg_tipe, ' ', a.brg_lengan, ' ', a.brg_jeniskain, ' ', a.brg_warna)) LIKE ?
      )

    -- Filter: Only show items with 0 or less stock
    HAVING stok_akhir <= 0

    ORDER BY nama_barang, b.brgd_ukuran
    LIMIT 100;
  `;

  // Params order:
  // 1. Branch for subquery
  // 2-4. Search patterns
  const params = [branchToCheck, searchPattern, searchPattern, searchPattern];

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
  getSalesTargetSummary,
  getBranchPerformance,
  getStagnantStockSummary,
  getTotalSisaPiutang,
  getPiutangPerCabang,
  getPiutangPerInvoice,
  getTotalStock,
  getStockPerCabang,
  getItemSalesTrend,
  getStockAlerts,
  getStokKosongReguler,
};
