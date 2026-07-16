const pool = require("../config/database");
const {
  startOfMonth,
  endOfMonth,
  format,
  subDays,
  subMonths,
  subYears,
  subWeeks,
} = require("date-fns");

// Fungsi untuk mengambil statistik penjualan & transaksi hari ini
const getTodayStats = async (user, cabangOverride = null) => {
  const today = format(new Date(), "yyyy-MM-dd");
  const isKDC = user.cabang === "KDC";
  const excludePattern = "^K[0-9]{2}\\.(SD|BR|PM|DP|TG|PL|SB)\\.";

  // [BARU] targetCabang: cabang yang jadi acuan filter query.
  // - Non-KDC: selalu cabangnya sendiri (perilaku lama, tidak berubah).
  // - KDC + cabangOverride diisi (dipakai AI tool): filter ke 1 cabang itu.
  // - KDC tanpa override (perilaku lama dashboard): null → mode agregat semua cabang.
  const targetCabang = !isKDC ? user.cabang : cabangOverride || null;

  let branchFilter = "";
  let params;

  if (targetCabang) {
    branchFilter = "AND h.inv_cab = ?";
    params = [excludePattern, today, today, targetCabang];
  } else {
    branchFilter = "";
    params = [excludePattern, today, today];
  }

  // 1. QUERY UTAMA (Total Agregat)
  const queryTotal = `
    SELECT
      COUNT(DISTINCT h.inv_nomor) AS todayTransactions,
      
      -- Total Nominal (Omset): Hitung SEMUA (termasuk Jasa/Custom)
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
          + h.inv_bkrm
      ) AS todaySales,

      -- Total Qty (Barang): Filter Jasa & Custom
      IFNULL(SUM(
        (
          SELECT SUM(dd.invd_jumlah) 
          FROM tinv_dtl dd 
          WHERE dd.invd_inv_nomor = h.inv_nomor
            AND dd.invd_kode NOT LIKE 'JASA%' 
            AND dd.invd_kode NOT REGEXP ?
        )
      ), 0) AS todayQty

    FROM tinv_hdr h
    WHERE h.inv_sts_pro = 0 
      AND h.inv_tanggal BETWEEN ? AND ?
      ${branchFilter};
  `;

  const [rows] = await pool.query(queryTotal, params);
  let result = rows[0];

  // 2. QUERY TAMBAHAN: BREAKDOWN PER CABANG (Hanya jika KDC)
  if (isKDC && !targetCabang) {
    // Gunakan logika matematika yang SAMA PERSIS dengan query utama
    // tapi dikelompokkan (GROUP BY) berdasarkan Cabang.
    const queryBreakdown = `
        SELECT 
            IFNULL(g.gdg_nama, h.inv_cab) AS nama,
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
                + h.inv_bkrm
            ) AS omset
        FROM tinv_hdr h
        LEFT JOIN tgudang g ON h.inv_cab = g.gdg_kode
        WHERE h.inv_sts_pro = 0 
          AND h.inv_tanggal BETWEEN ? AND ?
        GROUP BY h.inv_cab, g.gdg_nama
        ORDER BY omset DESC;
    `;

    try {
      // Parameternya cukup tanggal saja (start & end)
      const [breakdownRows] = await pool.query(queryBreakdown, [today, today]);
      result.salesBreakdown = breakdownRows; // [FIX] Pastikan nama property konsisten
    } catch (err) {
      console.error("Gagal load sales breakdown:", err);
      result.salesBreakdown = [];
    }
  } else {
    result.salesBreakdown = [];
  }

  return result;
};

// Fungsi untuk mengambil data grafik penjualan
const getSalesChartData = async (filters, user) => {
  // 1. Ambil 'groupBy' dari filters, default-nya 'day'
  const { startDate, endDate, cabang, groupBy = "day" } = filters;
  let params = [startDate, endDate];
  let branchFilter = "";

  // Logika filter cabang tidak berubah
  if (user.cabang === "KDC" && cabang && cabang !== "ALL") {
    branchFilter = "AND h.inv_cab = ?";
    params.push(cabang);
  } else if (user.cabang !== "KDC") {
    branchFilter = "AND h.inv_cab = ?";
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
  let branchFilter = "AND h.inv_cab = ?";
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
  const allTimeDate = "2020-01-01";

  // Helper: Jika user KDC (Pusat), abaikan filter. Jika Cabang, pasang filter.
  // params akan diisi [tanggal, cabang] atau [tanggal] saja.
  const params =
    user.cabang === "KDC" ? [allTimeDate] : [allTimeDate, user.cabang];

  // Helper untuk membuat WHERE clause dinamis berdasarkan kolom cabang tabel terkait
  const getBranchFilter = (colName) => {
    if (user.cabang === "KDC") return "";
    return `AND ${colName} = ?`;
  };

  // --- 1. PENAWARAN (tpenawaran_hdr -> pen_cab) ---
  const penawaranQuery = `
        SELECT COUNT(*) as count 
        FROM tpenawaran_hdr h
        WHERE h.pen_tanggal >= ? 
          AND NOT EXISTS (SELECT 1 FROM tso_hdr so WHERE so.so_pen_nomor = h.pen_nomor)
          AND (h.pen_alasan IS NULL OR h.pen_alasan = '')
          ${getBranchFilter("h.pen_cab")}; 
    `;

  // --- 2. PENGAJUAN HARGA (tpengajuanharga -> ph_cab) ---
  const pengajuanQuery = `
        SELECT COUNT(*) as count 
        FROM tpengajuanharga h
        WHERE h.ph_tanggal >= ?
          AND (h.ph_apv IS NULL OR h.ph_apv = '')
          ${getBranchFilter("h.ph_cab")};
    `;

  // --- 3. SO OPEN (tso_hdr -> so_cab) ---
  const soOpenQuery = `
      SELECT COUNT(*) as count FROM (
          SELECT 
              (CASE
                  -- Jika so_close bukan 0, otomatis dianggap DICLOSE
                  WHEN y.sts <> 0 THEN "DICLOSE"
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
                  WHERE h.so_tanggal >= ? 
                    AND h.so_aktif = 'Y' 
                    AND h.so_close = 0 
                    
                    AND h.so_nomor NOT IN (
                        SELECT DISTINCT inv_nomor_so 
                        FROM tinv_hdr 
                        WHERE inv_nomor_so IS NOT NULL AND inv_nomor_so <> ''
                    )
                    ${getBranchFilter("h.so_cab")}
              ) x
          ) y
      ) z
      WHERE z.StatusFinal = 'OPEN';
  `;

  // --- 4. SISA PIUTANG (tpiutang_hdr -> ph_cab / ph_kecab) ---
  // PENTING: Cek tabel tpiutang_hdr. Jika error, ganti 'u.ph_cab' jadi 'u.ph_kecab'
  const invoiceQuery = `
        SELECT COUNT(*) AS count
        FROM tpiutang_hdr u
        LEFT JOIN (
            SELECT pd_ph_nomor, SUM(pd_debet) AS debet, SUM(pd_kredit) AS kredit 
            FROM tpiutang_dtl GROUP BY pd_ph_nomor
        ) v ON v.pd_ph_nomor = u.ph_nomor
        WHERE u.ph_tanggal >= ? 
          AND (IFNULL(v.debet, 0) - IFNULL(v.kredit, 0)) > 100 
          ${getBranchFilter("u.ph_cab")}; 
    `;

  // --- 5. SO DTF (tsodtf_hdr -> sd_cab) ---
  const soDtfOpenQuery = `
        SELECT COUNT(*) as count 
        FROM tsodtf_hdr h
        WHERE h.sd_stok = "" 
          AND h.sd_tanggal >= ? 
          -- TAMBAHKAN FILTER INI: Abaikan yang sudah di-close
          AND h.sd_closing <> 'Y' 
          AND NOT EXISTS (SELECT 1 FROM tinv_dtl dd WHERE dd.invd_sd_nomor = h.sd_nomor)
          ${getBranchFilter("h.sd_cab")};
    `;

  try {
    const [
      [penawaranResult],
      [pengajuanResult],
      [soOpenResult],
      [invoiceResult],
      [soDtfOpenResult],
    ] = await Promise.all([
      pool.query(penawaranQuery, params),
      pool.query(pengajuanQuery, params),
      pool.query(soOpenQuery, params),
      pool.query(invoiceQuery, params),
      pool.query(soDtfOpenQuery, params),
    ]);

    return {
      penawaran_open: penawaranResult[0] ? penawaranResult[0].count : 0,
      pengajuan_harga_pending: pengajuanResult[0]
        ? pengajuanResult[0].count
        : 0,
      so_open: soOpenResult[0] ? soOpenResult[0].count : 0,
      invoice_belum_lunas: invoiceResult[0] ? invoiceResult[0].count : 0,
      so_dtf_open: soDtfOpenResult[0] ? soDtfOpenResult[0].count : 0,
    };
  } catch (error) {
    console.error("Error getPendingActions:", error);
    throw error;
  }
};

const getTopSellingProducts = async (
  user,
  branchFilter = "",
  dateRange = null,
) => {
  const startDate =
    dateRange?.startDate || format(startOfMonth(new Date()), "yyyy-MM-dd");
  const endDate =
    dateRange?.endDate || format(endOfMonth(new Date()), "yyyy-MM-dd");

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
    query += ` AND h.inv_cab = ? `;
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

const getSalesTargetSummary = async (
  user,
  cabangOverride = null,
  dateRange = null,
) => {
  // [BARU] Terima cabang & rentang tanggal opsional (mis. "target Jember
  // Januari 2026"). Target (kpi.ttarget_kaosan) tetap per BULAN — kalau
  // dateRange bukan 1 bulan penuh, target/ach tetap pakai target bulan
  // tempat startDate berada (sama seperti pola getBranchPerformance).
  const now = new Date();
  let startDate, endDate, tahun, bulan;

  if (dateRange && dateRange.startDate && dateRange.endDate) {
    startDate = dateRange.startDate;
    endDate = dateRange.endDate;
    const refDate = new Date(startDate);
    tahun = refDate.getFullYear();
    bulan = refDate.getMonth() + 1;
  } else {
    tahun = now.getFullYear();
    bulan = now.getMonth() + 1;
    startDate = format(new Date(tahun, bulan - 1, 1), "yyyy-MM-dd");
    endDate = format(now, "yyyy-MM-dd");
  }

  // Cabang eksplisit menang; kalau tidak ada dan user bukan KDC, otomatis
  // pakai cabang sendiri (perilaku lama tidak berubah). KDC tanpa cabang
  // spesifik = gabungan semua cabang (perilaku lama juga tidak berubah).
  const effectiveCabang =
    cabangOverride || (user.cabang !== "KDC" ? user.cabang : null);

  let targetCabangSql = "";
  let branchFilterSql = "";
  const params = [];

  // Placeholder target (muncul lebih dulu secara TEKSTUAL di query, di
  // dalam SELECT — jadi harus di-push lebih dulu di params juga)
  params.push(tahun, bulan);
  if (effectiveCabang) {
    targetCabangSql = "AND t.kode_gudang = ?";
    params.push(effectiveCabang);
  }

  // Placeholder penjualan (muncul di WHERE, setelah SELECT secara tekstual)
  params.push(startDate, endDate);
  if (effectiveCabang) {
    branchFilterSql = "AND h.inv_cab = ?";
    params.push(effectiveCabang);
  }

  const query = `
        SELECT 
            IFNULL(SUM(
                (SELECT SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) FROM tinv_dtl dd WHERE dd.invd_inv_nomor = h.inv_nomor) - h.inv_disc
            ), 0) AS nominal,
            IFNULL((
                SELECT SUM(t.target_omset) 
                FROM kpi.ttarget_kaosan t 
                WHERE t.tahun = ? AND t.bulan = ? ${targetCabangSql}
            ), 0) AS target
        FROM tinv_hdr h
        WHERE h.inv_sts_pro = 0 AND h.inv_tanggal BETWEEN ? AND ?
        ${branchFilterSql};
    `;

  const [rows] = await pool.query(query, params);
  return rows[0];
};

/**
 * Mengambil 3 cabang performa terbaik dan terburuk
 * berdasarkan pencapaian target bulan ini.
 */
const getBranchPerformance = async (user, dateRange = null) => {
  // Fitur ini hanya relevan untuk KDC (Head Office)
  if (user.cabang !== "KDC") {
    return [];
  }

  // [BARU] Terima rentang tanggal opsional (mis. "minggu lalu"). Target
  // (kpi.ttarget_kaosan) cuma tersimpan per BULAN, jadi target/ach tetap
  // pakai target bulan tempat startDate berada — akurat untuk ranking
  // OMSET di rentang manapun, tapi persentase pencapaian jadi kurang presisi
  // kalau rentangnya bukan 1 bulan penuh (dijelaskan lagi di formatter AI).
  const now = new Date();
  let startDate, endDate, tahun, bulan;

  if (dateRange && dateRange.startDate && dateRange.endDate) {
    startDate = dateRange.startDate;
    endDate = dateRange.endDate;
    const refDate = new Date(startDate);
    tahun = refDate.getFullYear();
    bulan = refDate.getMonth() + 1;
  } else {
    tahun = now.getFullYear();
    bulan = now.getMonth() + 1;
    startDate = format(new Date(tahun, bulan - 1, 1), "yyyy-MM-dd");
    endDate = format(now, "yyyy-MM-dd");
  }

  const query = `
    WITH MonthlySales AS (
      SELECT 
        cabang, 
        SUM(nominal) AS nominal 
        FROM v_sales_harian
      WHERE tanggal BETWEEN ? AND ?
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
    -- [PERBAIKAN] Hitung Retur Berdasarkan Jenis (Achievement Mode)
    MonthlyReturns AS (
      SELECT 
        rh.rj_cab AS cabang,
          SUM(
              CASE 
                        -- Tukar Barang: Selisih antara barang balik vs barang keluar baru
                        WHEN rh.rj_jenis = 'N' THEN (
                            SELECT GREATEST(0, 
                                IFNULL(SUM(rd.rjd_jumlah * (rd.rjd_harga - rd.rjd_diskon)), 0) - 
                                IFNULL((SELECT SUM(inv_rj_rp) FROM tinv_hdr WHERE inv_rj_nomor = rh.rj_nomor), 0)
                            )
                            FROM trj_dtl rd WHERE rd.rjd_nomor = rh.rj_nomor
                        )
                        -- Refund: Nominal uang yang benar-benar keluar ke customer
                        WHEN rh.rj_jenis = 'Y' THEN (
                            SELECT IFNULL(SUM(rfd_refund), 0) 
                            FROM trefund_dtl 
                            WHERE rfd_notrs = rh.rj_inv -- Link via No. Invoice Asal
                        )
                        ELSE 0
                    END
                ) AS total_retur
            FROM trj_hdr rh
            WHERE rh.rj_tanggal BETWEEN ? AND ?
            GROUP BY rh.rj_cab
        ),
        -- [BARU] Hitung Biaya Platform (Marketplace Fee)
        MonthlyFees AS (
            SELECT 
                inv_cab AS cabang,
                SUM(COALESCE(inv_mp_biaya_platform, 0)) AS total_fee
            FROM tinv_hdr
            WHERE inv_tanggal BETWEEN ? AND ?
            GROUP BY inv_cab
        )
        SELECT 
            g.gdg_kode AS kode_cabang,
            g.gdg_nama AS nama_cabang,
            
            -- Hitung Netto: Omset Kotor - Retur - Biaya Platform
            (
                COALESCE(ms.nominal, 0) 
                - COALESCE(mr.total_retur, 0)
                - COALESCE(mf.total_fee, 0) -- [BARU] Kurangi Fee
            ) AS nominal,
            
            COALESCE(mt.target, 0) AS target,
            
            -- Hitung Achievement (Update rumus dengan nominal netto)
            CASE 
                WHEN COALESCE(mt.target, 0) > 0 THEN 
                    (
                        (COALESCE(ms.nominal, 0) - COALESCE(mr.total_retur, 0) - COALESCE(mf.total_fee, 0)) 
                        / mt.target
                    ) * 100 
                ELSE 0 
            END AS ach
            
        FROM tgudang g
        LEFT JOIN MonthlySales ms ON g.gdg_kode = ms.cabang
        LEFT JOIN MonthlyTargets mt ON g.gdg_kode = mt.cabang
        LEFT JOIN MonthlyReturns mr ON g.gdg_kode = mr.cabang
        LEFT JOIN MonthlyFees mf ON g.gdg_kode = mf.cabang -- [BARU] Join Fee
        WHERE 
            (g.gdg_dc = 0 OR g.gdg_kode = 'KPR' OR g.gdg_kode = 'KON') 
            AND g.gdg_kode <> 'KDC'
        ORDER BY ach DESC;
    `;

  // [PENTING] Tambahkan parameter tahun & bulan untuk CTE MonthlyFees (Total 8 parameter)
  // Urutan sesuai posisi '?' di query: Sales(start,end) -> Target(tahun,bulan) -> Returns(start,end) -> Fees(start,end)
  const params = [
    startDate,
    endDate,
    tahun,
    bulan,
    startDate,
    endDate,
    startDate,
    endDate,
  ];

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
  let salesBranchFilter = "AND h.inv_cab = ?";
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
 * @description Menghitung total sisa piutang (Sisa >= 500).
 */
const getTotalSisaPiutang = async (user) => {
  let branchFilter = "AND u.ph_cab = ?";
  let params = [user.cabang];

  if (user.cabang === "KDC") {
    // [PERBAIKAN] Kecualikan invoice KDC agar angka total sinkron
    branchFilter = "AND u.ph_inv_nomor NOT LIKE 'KDC.INV.%'";
    params = [];
  }

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
    WHERE (IFNULL(v.debet, 0) - IFNULL(v.kredit, 0)) >= 500 ${branchFilter};
  `;

  const [rows] = await pool.query(query, params);
  return rows[0];
};

/**
 * @description Menghitung sisa piutang per cabang (HANYA UNTUK KDC, Sisa >= 500).
 */
const getPiutangPerCabang = async (user, cabangFilter = null) => {
  if (user.cabang !== "KDC") return [];

  // [BARU] Filter opsional ke 1 baris cabang/channel spesifik (mis. KPR, KON,
  // atau kode toko biasa) — dipakai AI tool. Parameter opsional, backward
  // compatible dengan pemanggilan lama tanpa argumen kedua.
  let filterSql = "";
  const params = [];
  if (cabangFilter && cabangFilter !== "ALL") {
    filterSql = "AND u.ph_cab = ?";
    params.push(cabangFilter);
  }

  const query = `
    SELECT 
      u.ph_cab AS cabang_kode,
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
    LEFT JOIN tgudang g ON g.gdg_kode = u.ph_cab
    WHERE (IFNULL(v.debet, 0) - IFNULL(v.kredit, 0)) >= 500
      AND u.ph_inv_nomor NOT LIKE 'KDC.INV.%'
      ${filterSql}
    GROUP BY u.ph_cab, g.gdg_nama
    ORDER BY sisa_piutang DESC;
  `;

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * @description Invoice yang masih punya sisa piutang untuk store tertentu (Sisa >= 500 + Nama Customer).
 */
const getPiutangPerInvoice = async (user, targetCabang) => {
  let invoiceFilter = "";
  let params = [];

  if (user.cabang === "KDC") {
    if (targetCabang && targetCabang !== "ALL") {
      // Jika KDC melihat rincian cabang spesifik
      invoiceFilter = "AND u.ph_inv_nomor LIKE ?";
      params.push(`${targetCabang}.INV.%`);
    } else {
      // Jika KDC melihat semua, KECUALIKAN invoice KDC
      invoiceFilter = "AND u.ph_inv_nomor NOT LIKE 'KDC.INV.%'";
    }
  } else {
    // Toko hanya melihat miliknya sendiri
    invoiceFilter = "AND u.ph_inv_nomor LIKE ?";
    params.push(`${user.cabang}.INV.%`);
  }

  const query = `
        SELECT 
            u.ph_inv_nomor AS invoice,
            DATE_FORMAT(h.inv_tanggal, '%Y-%m-%d') AS tanggal,
            c.cus_nama AS customer_nama,
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
        LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
        WHERE (IFNULL(v.debet, 0) - IFNULL(v.kredit, 0)) >= 500 
          ${invoiceFilter}
        ORDER BY sisa_piutang DESC;
    `;

  const [rows] = await pool.query(query, params);
  return rows;
};

const getTotalStock = async (user) => {
  let branchFilter = "AND m.mst_cab = ?";
  let params = [];

  // Filter cabang untuk K03
  if (user.cabang && user.cabang !== "KDC") {
    params.push(user.cabang);
  } else {
    branchFilter = "";
  }

  const excludePattern = "^K[0-9]{2}\\.(SD|BR|PM|DP|TG|PL|SB)\\.";

  // [KUNCI PERBAIKAN]: Pisahkan SUM antara RAK dan BOOKING
  const totalQuery = `
    SELECT
      -- 1. STOK RAK (Murni fisik hasil opname & koreksi SOK)
      SUM(IFNULL(s.stok_rak, 0)) AS totalStock,
      
      -- 2. STOK PESANAN (Uang muka/booking yang menggantung di SO)
      SUM(IFNULL(s.stok_booking, 0)) AS totalReserved
    FROM (
      SELECT 
        m.mst_brg_kode, 
        m.mst_ukuran, 
        SUM(CASE WHEN m.sumber = 'RAK' THEN (m.mst_stok_in - m.mst_stok_out) ELSE 0 END) AS stok_rak,
        SUM(CASE WHEN m.sumber = 'SO' THEN (m.mst_stok_in - m.mst_stok_out) ELSE 0 END) AS stok_booking
      FROM (
        -- Tabel Fisik (Yang kita koreksi pakai SOK kemarin)
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif, 'RAK' as sumber 
        FROM tmasterstok
        UNION ALL
        -- Tabel Pesanan (Penyebab angka jadi gendut kalau SO-nya gak beres)
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif, 'SO' as sumber 
        FROM tmasterstokso
      ) m
      WHERE m.mst_aktif = 'Y' 
        ${branchFilter}
        AND m.mst_brg_kode NOT LIKE 'JASA%'
        AND m.mst_brg_kode NOT REGEXP ?     
      GROUP BY m.mst_brg_kode, m.mst_ukuran, m.mst_cab
    ) s;
  `;

  // Query In/Out harian (Tetap sama)
  let todayIn = 0;
  let todayOut = 0;
  if (user.cabang !== "KDC") {
    const today = format(new Date(), "yyyy-MM-dd");
    const dailyQuery = `
        SELECT SUM(mst_stok_in) as stokIn, SUM(mst_stok_out) as stokOut
        FROM tmasterstok WHERE mst_aktif = 'Y' AND mst_cab = ? AND mst_tanggal = ?
        AND mst_brg_kode NOT LIKE 'JASA%' AND mst_brg_kode NOT REGEXP ?
    `;
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

  const [rows] = await pool.query(totalQuery, [...params, excludePattern]);

  return {
    // Balikkan totalStock HANYA yang ada di RAK (Fisik) agar angka Dashboard K03 normal kembali
    totalStock: Number(rows[0]?.totalStock || 0),
    reservedStock: Number(rows[0]?.totalReserved || 0),
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

const getItemSalesTrend = async (user, filters = {}) => {
  const { isExport = false, cabang = "ALL" } = filters;

  if (user.cabang !== "KDC") return [];

  let branchFilter = "";
  let params = [];

  // 1. Logika Filter Cabang
  if (cabang && cabang !== "ALL") {
    branchFilter = "AND h.inv_cab = ?";
    params.push(cabang);
  }

  // 2. [FITUR DINAMIS] Tentukan syarat jumlah toko
  // Jika ALL: harus laku di > 1 toko (Tren Global)
  // Jika Cabang Spesifik: cukup >= 1 (Tren Lokal Cabang tsb)
  const havingCondition =
    cabang === "ALL"
      ? "HAVING store_count_now > 1"
      : "HAVING store_count_now >= 1";

  const query = `
    SELECT 
        a.brg_kode AS kode,
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
        COUNT(DISTINCT CASE WHEN month_diff = 0 THEN h.inv_cab END) AS store_count_now,
        
        -- TAHUN INI
        COALESCE(SUM(CASE WHEN month_diff = 0 THEN d.invd_jumlah ELSE 0 END) / NULLIF(COUNT(DISTINCT CASE WHEN month_diff = 0 THEN h.inv_cab END), 0), 0) AS avg_now,
        COALESCE(SUM(CASE WHEN month_diff = 1 THEN d.invd_jumlah ELSE 0 END) / NULLIF(COUNT(DISTINCT CASE WHEN month_diff = 1 THEN h.inv_cab END), 0), 0) AS avg_min_1,
        COALESCE(SUM(CASE WHEN month_diff = 2 THEN d.invd_jumlah ELSE 0 END) / NULLIF(COUNT(DISTINCT CASE WHEN month_diff = 2 THEN h.inv_cab END), 0), 0) AS avg_min_2,
        COALESCE(SUM(CASE WHEN month_diff = 3 THEN d.invd_jumlah ELSE 0 END) / NULLIF(COUNT(DISTINCT CASE WHEN month_diff = 3 THEN h.inv_cab END), 0), 0) AS avg_min_3,

        -- TAHUN LALU
        COALESCE(SUM(CASE WHEN month_diff = 12 THEN d.invd_jumlah ELSE 0 END) / NULLIF(COUNT(DISTINCT CASE WHEN month_diff = 12 THEN h.inv_cab END), 0), 0) AS avg_ly_now,
        COALESCE(SUM(CASE WHEN month_diff = 11 THEN d.invd_jumlah ELSE 0 END) / NULLIF(COUNT(DISTINCT CASE WHEN month_diff = 11 THEN h.inv_cab END), 0), 0) AS avg_ly_plus_1,
        COALESCE(SUM(CASE WHEN month_diff = 10 THEN d.invd_jumlah ELSE 0 END) / NULLIF(COUNT(DISTINCT CASE WHEN month_diff = 10 THEN h.inv_cab END), 0), 0) AS avg_ly_plus_2

    FROM tinv_hdr h
    JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
    JOIN tbarangdc a ON a.brg_kode = d.invd_kode
    LEFT JOIN (
        SELECT inv_nomor, 
        PERIOD_DIFF(DATE_FORMAT(NOW(), '%Y%m'), DATE_FORMAT(inv_tanggal, '%Y%m')) as month_diff
        FROM tinv_hdr
    ) diff ON diff.inv_nomor = h.inv_nomor
    WHERE h.inv_sts_pro = 0 
      AND a.brg_warna NOT LIKE '%STICKER%' 
      AND a.brg_jeniskaos NOT LIKE '%STIKER%'
      AND a.brg_jeniskaos NOT LIKE '%DTF%'
      AND a.brg_aktif = 0
      AND diff.month_diff IN (0, 1, 2, 3, 10, 11, 12)
      ${branchFilter}
    GROUP BY a.brg_kode, nama
    ${havingCondition} -- [FIX] Masukkan kondisi dinamis di sini
    ORDER BY avg_now DESC
    ${isExport ? "" : "LIMIT 10"};
  `;

  // [PENTING] Kirim variabel 'params' agar filter '?' di SQL terisi
  const [rows] = await pool.query(query, params);
  return rows;
};

const getStockAlerts = async (user) => {
  const cabang = user.cabang;

  // 1. Cek Surat Jalan (SJ) dari DC yang belum diterima
  const querySj = `
    SELECT COUNT(*) AS total 
    FROM tdc_sj_hdr 
    WHERE sj_kecab = ? 
      AND (sj_noterima IS NULL OR sj_noterima = '') 
      AND sj_tanggal >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
  `;

  // 2. Cek Mutasi Kiriman dari Store Lain yang belum diterima
  const queryMutasi = `
    SELECT COUNT(*) AS total 
    FROM tmsk_hdr 
    WHERE msk_kecab = ? 
      AND (msk_noterima IS NULL OR msk_noterima = '')
      AND msk_tanggal >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
  `;

  // 3. [UPDATE] Cek Retur yang perlu diproses
  let queryRetur = "";
  let paramsRetur = [];

  if (cabang === "KDC") {
    // UNTUK DC: Hitung semua retur dari toko yang BELUM diterima oleh DC
    queryRetur = `
      SELECT COUNT(*) AS total
      FROM trbdc_hdr
      WHERE (rb_noterima IS NULL OR rb_noterima = '')
        AND rb_tanggal >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
    `;
  } else {
    // UNTUK STORE: Hitung retur miliknya sendiri yang belum di-acc DC
    queryRetur = `
      SELECT COUNT(*) AS total
      FROM trbdc_hdr
      WHERE rb_cab = ?
        AND (rb_noterima IS NULL OR rb_noterima = '')
        AND rb_tanggal >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
    `;
    paramsRetur.push(cabang);
  }

  // 4. [BARU] Cek Peminjaman Overdue (> 14 hari belum kembali)
  // KDC bisa melihat semua cabang, Store hanya cabangnya sendiri
  let queryPinjam = "";
  let paramsPinjam = [];

  if (cabang === "KDC") {
    queryPinjam = `
      SELECT COUNT(*) AS total 
      FROM tpeminjaman_hdr 
      WHERE pj_status_kembali = 'N' 
        AND DATEDIFF(NOW(), pj_tanggal) > 14
    `;
  } else {
    queryPinjam = `
      SELECT COUNT(*) AS total 
      FROM tpeminjaman_hdr 
      WHERE pj_cab = ? 
        AND pj_status_kembali = 'N' 
        AND DATEDIFF(NOW(), pj_tanggal) > 14
    `;
    paramsPinjam.push(cabang);
  }

  // 5. [BARU] Cek Memo Internal yang diupload hari ini
  const queryMemo = `
  SELECT 
    COUNT(*) AS total, 
    MAX(mi_date_upload) AS latest_date -- Ambil tanggal upload terakhir
  FROM tmemo_internal
`;

  // 6. [BARU] Cek Invoice Jatuh Tempo (Lewat TOP)
  let queryPiutangOverdue = "";
  let paramsPiutangOverdue = [];

  if (cabang === "KDC") {
    // Mode KDC: Perhitungan dilakukan dengan standar JOIN + HAVING
    // Filter tanggal dilakukan terlebih dahulu agar jumlah baris yang di JOIN sedikit
    queryPiutangOverdue = `
      SELECT COUNT(*) AS total
      FROM (
        SELECT u.ph_nomor
        FROM tpiutang_hdr u
        JOIN tpiutang_dtl d ON u.ph_nomor = d.pd_ph_nomor
        WHERE DATE_ADD(u.ph_tanggal, INTERVAL u.ph_top DAY) < CURDATE()
        GROUP BY u.ph_nomor
        HAVING (SUM(d.pd_debet) - SUM(d.pd_kredit)) > 100
      ) AS overdue_invoices
    `;
  } else {
    // Mode Cabang: Sama, filter cabang dan tanggal dulu, baru gabung dan cek selisihnya
    queryPiutangOverdue = `
      SELECT COUNT(*) AS total
      FROM (
        SELECT u.ph_nomor
        FROM tpiutang_hdr u
        JOIN tpiutang_dtl d ON u.ph_nomor = d.pd_ph_nomor
        WHERE u.ph_cab = ?
          AND DATE_ADD(u.ph_tanggal, INTERVAL u.ph_top DAY) < CURDATE()
        GROUP BY u.ph_nomor
        HAVING (SUM(d.pd_debet) - SUM(d.pd_kredit)) > 100
      ) AS overdue_invoices
    `;
    paramsPiutangOverdue.push(cabang);
  }

  // Jalankan Query secara paralel
  const [rowsSj, rowsMutasi, rowsRetur, rowsPinjam, rowsMemo, rowsPiutang] =
    await Promise.all([
      pool.query(querySj, [cabang]),
      pool.query(queryMutasi, [cabang]),
      pool.query(queryRetur, paramsRetur),
      pool.query(queryPinjam, paramsPinjam),
      pool.query(queryMemo),
      pool.query(queryPiutangOverdue, paramsPiutangOverdue),
    ]);

  return {
    sj_pending: rowsSj[0][0].total || 0,
    mutasi_pending: rowsMutasi[0][0].total || 0,
    retur_pending: rowsRetur[0][0].total || 0,
    pinjam_overdue: rowsPinjam[0][0].total || 0,
    new_memo_count: rowsMemo[0][0].total || 0,
    latest_memo_date: rowsMemo[0][0].latest_date || null,
    piutang_overdue: rowsPiutang[0][0].total || 0,
  };
};

const getStokKosongReguler = async (
  user,
  searchTerm = "",
  targetCabang = "",
  isExport = false,
  page = 1,
  limit = 50,
) => {
  // Jika user adalah KDC dan tidak ada target, paksa default jadi 'ALL'
  let branchToCheck =
    user.cabang === "KDC" ? targetCabang || "ALL" : user.cabang;

  const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
  const limitClause = isExport ? "" : "LIMIT ? OFFSET ?";

  // OPTIMASI 1: Jangan gunakan LIKE '%...%' jika user tidak mengetik pencarian
  let searchCondition = "";
  let searchParams = [];
  if (searchTerm && searchTerm.trim() !== "") {
    // [FIX] Pecah jadi kata per kata, wajibkan SEMUA kata ketemu (posisi
    // bebas) di nama barang — toleran kalau AI menyusun kata kunci dengan
    // urutan sedikit beda dari urutan field asli, atau ada kata terlewat.
    const keywords = searchTerm.trim().split(/\s+/).filter(Boolean);
    const namaCondPerWord = keywords
      .map(
        () =>
          `TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), ' ', IFNULL(a.brg_tipe,''), ' ', IFNULL(a.brg_lengan,''), ' ', IFNULL(a.brg_jeniskain,''), ' ', IFNULL(a.brg_warna,''))) LIKE ?`,
      )
      .join(" AND ");

    searchCondition = `AND (
      (b.brgd_kode LIKE ? OR b.brgd_barcode LIKE ?)
      OR (${namaCondPerWord})
    )`;
    const exactPattern = `%${searchTerm.trim()}%`;
    const wordPatterns = keywords.map((k) => `%${k}%`);
    searchParams = [exactPattern, exactPattern, ...wordPatterns];
  }

  let query = "";
  let finalParams = [];

  if (branchToCheck === "ALL") {
    // --- MODE PECAH PER TOKO (ALL) ---
    query = `
      WITH ActiveStores AS (
          SELECT gdg_kode, gdg_nama FROM tgudang WHERE gdg_dc = 0
      ),
      MasterItems AS (
          SELECT 
              b.brgd_kode AS kode,
              b.brgd_barcode AS barcode,
              TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), ' ', IFNULL(a.brg_tipe,''), ' ', IFNULL(a.brg_lengan,''), ' ', IFNULL(a.brg_jeniskain,''), ' ', IFNULL(a.brg_warna,''))) AS nama_barang,
              b.brgd_ukuran AS ukuran
          FROM tbarangdc a
          JOIN tbarangdc_dtl b ON a.brg_kode = b.brgd_kode
          WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y' AND a.brg_ktgp = 'REGULER'
            AND b.brgd_ukuran IN ('S', 'M', 'L', 'XL', '2XL')
            ${searchCondition}
      ),
      -- OPTIMASI 2: Hitung Total Stok ke dalam tabel virtual terlebih dahulu
      AggregatedStock AS (
          SELECT mst_cab, mst_brg_kode, mst_ukuran, SUM(mst_stok_in - mst_stok_out) AS stok_akhir
          FROM tmasterstok
          WHERE mst_aktif = 'Y' AND mst_cab IN (SELECT gdg_kode FROM ActiveStores)
          GROUP BY mst_cab, mst_brg_kode, mst_ukuran
      )
      SELECT 
          s.gdg_nama AS nama_cabang,
          mi.kode,
          mi.barcode,
          mi.nama_barang,
          mi.ukuran,
          IFNULL(agg.stok_akhir, 0) AS stok_akhir
      FROM ActiveStores s
      CROSS JOIN MasterItems mi 
      LEFT JOIN AggregatedStock agg ON mi.kode = agg.mst_brg_kode 
          AND mi.ukuran = agg.mst_ukuran 
          AND s.gdg_kode = agg.mst_cab
      WHERE IFNULL(agg.stok_akhir, 0) <= 0
      ORDER BY mi.nama_barang, mi.ukuran, s.gdg_kode
      ${limitClause};
    `;
    finalParams = [...searchParams];
  } else {
    // --- MODE SINGLE CABANG ---
    query = `
      WITH TargetStore AS (
          SELECT gdg_kode, gdg_nama FROM tgudang WHERE gdg_kode = ? AND gdg_dc = 0
      ),
      MasterItems AS (
          SELECT 
              b.brgd_kode AS kode,
              b.brgd_barcode AS barcode,
              TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), ' ', IFNULL(a.brg_tipe,''), ' ', IFNULL(a.brg_lengan,''), ' ', IFNULL(a.brg_jeniskain,''), ' ', IFNULL(a.brg_warna,''))) AS nama_barang,
              b.brgd_ukuran AS ukuran
          FROM tbarangdc a
          JOIN tbarangdc_dtl b ON a.brg_kode = b.brgd_kode
          WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y' AND a.brg_ktgp = 'REGULER'
            AND b.brgd_ukuran IN ('S', 'M', 'L', 'XL', '2XL')
            ${searchCondition}
      ),
      -- OPTIMASI 2: Hitung Total Stok ke dalam tabel virtual terlebih dahulu (Khusus 1 Cabang)
      AggregatedStock AS (
          SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in - mst_stok_out) AS stok_akhir
          FROM tmasterstok
          WHERE mst_aktif = 'Y' AND mst_cab = ?
          GROUP BY mst_brg_kode, mst_ukuran
      )
      SELECT 
          (SELECT gdg_nama FROM TargetStore) AS nama_cabang,
          mi.kode,
          mi.barcode,
          mi.nama_barang,
          mi.ukuran,
          IFNULL(agg.stok_akhir, 0) AS stok_akhir
      FROM MasterItems mi
      LEFT JOIN AggregatedStock agg ON mi.kode = agg.mst_brg_kode 
          AND mi.ukuran = agg.mst_ukuran 
      WHERE IFNULL(agg.stok_akhir, 0) <= 0
      ORDER BY mi.nama_barang, mi.ukuran
      ${limitClause};
    `;
    finalParams = [branchToCheck, ...searchParams, branchToCheck];
  }

  // Jika bukan export, masukkan parameter limit & offset ke SQL
  if (!isExport) {
    finalParams.push(parseInt(limit), parseInt(offset));
  }

  const [allRows] = await pool.query(query, finalParams);
  return { data: allRows, totalCount: allRows.length };
};

const getParetoStockHealth = async (req, res) => {
  const { gudang } = req.query;
  const connection = await pool.getConnection();

  try {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const startDateStr = firstDay.toISOString().split("T")[0];

    // Cek apakah request datang untuk KDC
    const isPusat = gudang === "KDC";

    let stokFilter = "";
    let salesFilter = "";
    let bufferFilter = "";
    let params = [startDateStr];

    if (isPusat) {
      // Jika KDC: Pareto dari Global Sales, Buffer dari Total Seluruh Toko, Stok dari KDC
      salesFilter = "";
      stokFilter = "AND m.mst_cab = 'KDC'";
      bufferFilter = "IN (SELECT gdg_kode FROM tgudang WHERE gdg_dc = 0)";
    } else {
      // Jika Toko: Sales, Buffer, dan Stok murni milik toko tersebut
      salesFilter = "AND h.inv_cab = ?";
      stokFilter = "AND m.mst_cab = ?";
      bufferFilter = "= ?";
      params.push(gudang); // Untuk Sales
    }

    // Tambah parameter untuk filter Buffer dan Stok (jika bukan KDC)
    if (!isPusat) params.push(gudang);
    if (!isPusat) params.push(gudang);

    const query = `
      SELECT 
        SUM(IFNULL(s.stok, 0)) AS total_actual_stock,
        SUM(IFNULL(buf.total_buffer, 0)) AS base_buffer_pareto,
        COUNT(DISTINCT a.brg_kode) AS count_pareto_sku,
        (SELECT COUNT(gdg_kode) FROM tgudang WHERE gdg_dc = 0) AS active_store_count
      FROM tbarangdc a
      
      -- Filter Pareto / Demand (Barang Laku Bulan Ini)
      INNER JOIN (
          SELECT DISTINCT d.invd_kode, d.invd_ukuran
          FROM tinv_dtl d
          JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
          WHERE h.inv_sts_pro = 0 
            AND h.inv_tanggal >= ? 
            ${salesFilter} 
      ) pareto ON a.brg_kode = pareto.invd_kode

      -- Hitung Target Buffer Masing-Masing Cabang
      LEFT JOIN (
          SELECT brgd_kode, brgd_ukuran, SUM(brgd_min) as total_buffer
          FROM tbarangdc_dtl2
          WHERE brgd_min > 0 AND brgd_cab ${bufferFilter}
          GROUP BY brgd_kode, brgd_ukuran
      ) buf ON a.brg_kode = buf.brgd_kode AND pareto.invd_ukuran = buf.brgd_ukuran

      -- Hitung Stok Fisik Murni
      LEFT JOIN (
          SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in - mst_stok_out) as stok
          FROM tmasterstok m WHERE m.mst_aktif = 'Y' ${stokFilter}
          GROUP BY mst_brg_kode, mst_ukuran
      ) s ON a.brg_kode = s.mst_brg_kode AND pareto.invd_ukuran = s.mst_ukuran

      -- Jangan hitung barang yang bersifat cetak langsung/Jasa
      WHERE a.brg_aktif = 0 
        AND a.brg_logstok = 'Y'
        AND a.brg_warna NOT LIKE '%STICKER%'
        AND a.brg_warna NOT LIKE '%STIKER%'
        AND a.brg_jeniskaos NOT LIKE '%DTF%'
        AND a.brg_kode NOT LIKE 'JASA%';
    `;

    const [rows] = await connection.query(query, params);
    const result = rows[0];

    const actual = Number(result.total_actual_stock) || 0;
    // Karena buf.total_buffer sudah merupakan SUM dari semua cabang (saat isPusat),
    // kita tidak perlu lagi mengalikannya dengan storeCount.
    const finalTargetBuffer = Number(result.base_buffer_pareto) || 0;
    const count = Number(result.count_pareto_sku) || 0;
    const storeCount = Number(result.active_store_count) || 1;

    let healthScore = 0;
    if (finalTargetBuffer > 0) {
      healthScore = (actual / finalTargetBuffer) * 100;
    } else if (actual > 0) {
      healthScore = 100;
    }

    res.json({
      score: healthScore.toFixed(1),
      actual_stock: actual,
      buffer_stock: finalTargetBuffer,
      sku_count: count,
      is_pusat: isPusat,
      store_count: storeCount,
    });
  } catch (error) {
    console.error("Error getParetoStockHealth:", error);
    res.status(500).json({ message: "Terjadi kesalahan." });
  } finally {
    connection.release();
  }
};

const getParetoDetails = async (req, res) => {
  const { gudang } = req.query;
  const connection = await pool.getConnection();

  try {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const startDateStr = firstDay.toISOString().split("T")[0];

    const isPusat = gudang === "KDC";

    let stokFilter = "";
    let salesFilter = "";
    let bufferFilter = "";
    let params = [startDateStr];

    if (isPusat) {
      salesFilter = "";
      stokFilter = "AND m.mst_cab = 'KDC'";
      bufferFilter = "IN (SELECT gdg_kode FROM tgudang WHERE gdg_dc = 0)";
    } else {
      salesFilter = "AND h.inv_cab = ?";
      stokFilter = "AND m.mst_cab = ?";
      bufferFilter = "= ?";
      params.push(gudang);
    }

    if (!isPusat) params.push(gudang);
    if (!isPusat) params.push(gudang);

    // 1. QUERY UTAMA: List Barang Pareto
    const queryItems = `
      SELECT 
        a.brg_kode AS kode,
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
        pareto.invd_ukuran AS ukuran,
        IFNULL(s.stok, 0) AS stok_aktual,
        IFNULL(buf.total_buffer, 0) AS buffer_base,
        pareto.qty_sold AS penjualan_bulan_ini
      FROM tbarangdc a
      INNER JOIN (
          SELECT d.invd_kode, d.invd_ukuran, SUM(d.invd_jumlah) as qty_sold
          FROM tinv_dtl d
          JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
          WHERE h.inv_sts_pro = 0 AND h.inv_tanggal >= ? ${salesFilter}
          GROUP BY d.invd_kode, d.invd_ukuran
      ) pareto ON a.brg_kode = pareto.invd_kode
      LEFT JOIN (
          SELECT brgd_kode, brgd_ukuran, SUM(brgd_min) as total_buffer
          FROM tbarangdc_dtl2
          WHERE brgd_min > 0 AND brgd_cab ${bufferFilter}
          GROUP BY brgd_kode, brgd_ukuran
      ) buf ON a.brg_kode = buf.brgd_kode AND pareto.invd_ukuran = buf.brgd_ukuran
      LEFT JOIN (
          SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in - mst_stok_out) as stok
          FROM tmasterstok m WHERE m.mst_aktif = 'Y' ${stokFilter}
          GROUP BY mst_brg_kode, mst_ukuran
      ) s ON a.brg_kode = s.mst_brg_kode AND pareto.invd_ukuran = s.mst_ukuran
      WHERE a.brg_aktif = 0 
        AND a.brg_logstok = 'Y'
        AND a.brg_warna NOT LIKE '%STICKER%'
        AND a.brg_warna NOT LIKE '%STIKER%'
        AND a.brg_jeniskaos NOT LIKE '%DTF%'
        AND a.brg_kode NOT LIKE 'JASA%'
      ORDER BY pareto.qty_sold DESC;
    `;

    const [items] = await connection.query(queryItems, params);

    // 2. QUERY TAMBAHAN: Detail Stok & Buffer Per Cabang (Untuk Expanded KDC)
    let branchDetails = [];
    if (items.length > 0 && isPusat) {
      const queryBreakdown = `
          SELECT 
            m.mst_cab AS cabang_kode,
            g.gdg_nama AS cabang_nama,
            m.mst_brg_kode AS kode,
            m.mst_ukuran AS ukuran,
            SUM(m.mst_stok_in - m.mst_stok_out) AS stok,
            IFNULL(b2.brgd_min, 0) AS target_toko
          FROM tmasterstok m
          LEFT JOIN tgudang g ON m.mst_cab = g.gdg_kode
          LEFT JOIN tbarangdc_dtl2 b2 ON b2.brgd_kode = m.mst_brg_kode 
               AND b2.brgd_ukuran = m.mst_ukuran AND b2.brgd_cab = m.mst_cab
          WHERE m.mst_aktif = 'Y' AND g.gdg_dc = 0
          GROUP BY m.mst_cab, m.mst_brg_kode, m.mst_ukuran, g.gdg_nama, b2.brgd_min
       `;
      const [details] = await connection.query(queryBreakdown);
      branchDetails = details;
    }

    // 3. Gabungkan Data (Merge)
    const result = items.map((row, index) => {
      const target = row.buffer_base; // Sudah utuh (total sum)

      let status = "AMAN";
      let color = "success";
      if (target > 0) {
        const ratio = (row.stok_aktual / target) * 100;
        if (ratio < 100) {
          status = "KRITIS";
          color = "error";
        } else if (ratio > 300) {
          status = "OVER";
          color = "warning";
        }
      } else if (row.stok_aktual <= 0) {
        status = "KRITIS";
        color = "error";
      }

      // Rincian cabang
      const itemBranches = isPusat
        ? branchDetails
            .filter((d) => d.kode === row.kode && d.ukuran === row.ukuran)
            .map((b) => ({
              nama: b.cabang_nama,
              stok: Number(b.stok),
              target_toko: Number(b.target_toko),
              status:
                Number(b.stok) < Number(b.target_toko)
                  ? "KRITIS"
                  : Number(b.stok) > Number(b.target_toko) * 3
                    ? "OVER"
                    : "AMAN",
            }))
        : [];

      // Sort yang kritis ke atas
      itemBranches.sort((a, b) => (a.status === "KRITIS" ? -1 : 1));

      return {
        rank: index + 1,
        kode: row.kode,
        nama: row.nama,
        ukuran: row.ukuran,
        stok: Number(row.stok_aktual),
        target: target,
        sales: Number(row.penjualan_bulan_ini),
        status,
        color,
        branches: itemBranches,
      };
    });

    res.json(result);
  } catch (error) {
    console.error("Error getParetoDetails:", error);
    res.status(500).json({ message: "Gagal mengambil detail pareto" });
  } finally {
    connection.release();
  }
};

// Fungsi mengambil jadwal kirim
const getShipmentSchedules = async (user) => {
  let branchFilter = "";
  let params = [];

  // Jika user Toko, hanya lihat jadwal untuk cabangnya sendiri
  if (user.cabang !== "KDC") {
    branchFilter = "WHERE j.cabang_tujuan = ?";
    params.push(user.cabang);
  }

  const query = `
        SELECT 
            j.id, 
            j.tanggal_kirim, 
            j.cabang_tujuan, 
            g.gdg_nama AS nama_cabang, 
            j.no_sj, 
            j.status, 
            j.keterangan 
        FROM tdashboard_jadwal_kirim j
        LEFT JOIN tgudang g ON j.cabang_tujuan = g.gdg_kode
        ${branchFilter}
        ORDER BY j.tanggal_kirim DESC, j.id DESC
        LIMIT 20;
    `;
  const [rows] = await pool.query(query, params);
  return rows;
};

// Fungsi menyimpan jadwal (Khusus KDC)
const saveShipmentSchedule = async (payload, user) => {
  const { tanggal_kirim, cabang_tujuan, keterangan, status } = payload;

  if (!tanggal_kirim || !cabang_tujuan) {
    throw new Error("Data tidak lengkap");
  }

  // Kita hapus created_at dari query karena DB akan mengisinya otomatis
  const query = `
        INSERT INTO tdashboard_jadwal_kirim 
        (tanggal_kirim, cabang_tujuan, keterangan, status, user_create)
        VALUES (?, ?, ?, ?, ?)
    `;

  const [result] = await pool.query(query, [
    tanggal_kirim,
    cabang_tujuan,
    keterangan || "",
    status || "Antri",
    user.kode, // Pastikan user.kode ini berisi username/id user
  ]);

  return { id: result.insertId, message: "Jadwal berhasil disimpan" };
};

const updateShipmentStatus = async (id, status) => {
  const query = `UPDATE tdashboard_jadwal_kirim SET status = ? WHERE id = ?`;
  await pool.query(query, [status, id]);
  return { message: "Status jadwal berhasil diperbarui" };
};

const getMasterJadwalRutin = async () => {
  const query = `SELECT * FROM tmaster_jadwal_rutin ORDER BY cabang_kode`;
  const [rows] = await pool.query(query);
  return rows;
};

const getCashflowSummary = async (user, targetDate = null) => {
  let finalDate =
    targetDate && targetDate !== "undefined" && targetDate !== ""
      ? targetDate
      : format(subDays(new Date(), 1), "yyyy-MM-dd");

  // Filter cabang
  let branchFilterInv =
    user.cabang !== "KDC"
      ? "AND LEFT(h.inv_nomor, 3) = ?"
      : "AND LEFT(h.inv_nomor, 3) <> 'KDC'";

  // [PERBAIKAN KUNCI 1] Sesuaikan nama alias 'h' untuk tabel header Petty Cash
  let branchFilterPc =
    user.cabang !== "KDC" ? "AND h.pc_cab = ?" : "AND h.pc_cab <> 'KDC'";

  let params = [finalDate];
  if (user.cabang !== "KDC") params.push(user.cabang);

  // 1. Query Invoice (Omset, HPP, Laba Kotor, Kas Aktual, Transaksi)
  const invQuery = `
    SELECT 
      IFNULL(SUM(ROUND(x.nominal)), 0) AS omset,
      IFNULL(SUM(ROUND(x.hpp)), 0) AS hpp,
      IFNULL(SUM(ROUND(x.nominal - x.hpp)), 0) AS laba_kotor,
      IFNULL(SUM(x.kas_masuk), 0) AS kas_aktual,
      COUNT(x.inv_nomor) AS jml_transaksi
    FROM (
      SELECT 
        h.inv_nomor,
        (
          SELECT (SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) - hh.inv_disc + (hh.inv_ppn / 100 * (SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) - hh.inv_disc)))
          FROM tinv_dtl dd LEFT JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor
          WHERE hh.inv_nomor = h.inv_nomor
        ) AS nominal,
        (
          SELECT SUM(dd.invd_jumlah * dd.invd_hpp)
          FROM tinv_dtl dd LEFT JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor
          WHERE hh.inv_nomor = h.inv_nomor
        ) AS hpp,
        -- Kas Masuk Riil: Tunai + Card/Transfer + DP (Tidak termasuk Piutang Murni)
        (h.inv_rptunai + h.inv_rpcard + h.inv_dp) AS kas_masuk
      FROM tinv_hdr h
      WHERE h.inv_sts_pro = 0 AND h.inv_tanggal = ? ${branchFilterInv}
    ) AS x
  `;
  const [invRows] = await pool.query(invQuery, params);

  // ========================================================================
  // [PERBAIKAN KUNCI 2] Query Petty Cash Akurat Harian
  // Kita jumlahkan dari tabel Detail (pcd_nominal) berdasarkan tanggal notanya
  // ========================================================================
  const pcQuery = `
    SELECT IFNULL(SUM(d.pcd_nominal), 0) AS pengeluaran 
    FROM tpettycash_dtl d
    INNER JOIN tpettycash_hdr h ON h.pc_nomor = d.pcd_nomor
    WHERE h.pc_status NOT IN ('REJECTED') 
      AND DATE(d.pcd_tanggal) = DATE(?) 
      ${branchFilterPc}
  `;
  const [pcRows] = await pool.query(pcQuery, params);

  const omset = Number(invRows[0].omset);
  const hpp = Number(invRows[0].hpp);
  const labaKotor = Number(invRows[0].laba_kotor);
  const kasAktual = Number(invRows[0].kas_aktual);
  const jmlTransaksi = Number(invRows[0].jml_transaksi);

  // Ambil total pengeluaran dari detail nota harian
  const pengeluaran = Number(pcRows[0].pengeluaran);

  // 3. Kalkulasi Business Intelligenconst sqlinsertce
  const labaBersih = labaKotor - pengeluaran;
  const margin = omset > 0 ? (labaKotor / omset) * 100 : 0;
  const basketSize = jmlTransaksi > 0 ? omset / jmlTransaksi : 0;

  return {
    omset,
    hpp,
    labaKotor,
    margin: Number(margin.toFixed(2)),
    pengeluaran,
    labaBersih,
    kasAktual,
    jmlTransaksi,
    basketSize: Math.round(basketSize),
  };
};

/**
 * Mengambil informasi spesifik cabang (Place ID Google Maps)
 */
const getBranchInfo = async (cabang) => {
  const query = `
    SELECT gdg_kode, gdg_nama, gdg_place_id, gdg_lat, gdg_long -- Tambahkan lat long di sini
    FROM tgudang 
    WHERE gdg_kode = ?
  `;

  const [rows] = await pool.query(query, [cabang]);
  return rows[0] || { gdg_place_id: null, gdg_lat: null, gdg_long: null };
};

// --- JADWAL BORDIR ---
const getBordirSchedules = async (filters = {}) => {
  const startDate =
    filters.startDate || format(subDays(new Date(), 7), "yyyy-MM-dd");
  const endDate = filters.endDate || format(new Date(), "yyyy-MM-dd");

  const query = `
    SELECT 
      h.sd_nomor    AS so_nomor,
      h.sd_tanggal  AS tanggal_so,
      h.sd_nama     AS customer,

      IFNULL((
        SELECT SUM(d.sdd_jumlah) 
        FROM tsodtf_dtl d 
        WHERE d.sdd_nomor = h.sd_nomor
      ), 0) AS jumlah_kaos,

      -- Qty sudah diterima workshop
      -- mw_so_dtf di tmutasi_workshop_hdr berisi nomor SO DTF (bisa multiple, pisah koma)
      -- Cari MWK yang mw_so_dtf mengandung nomor SO DTF ini,
      -- lalu cek apakah sudah ada penerimaan (mw_noterima terisi)
      IFNULL((
        SELECT SUM(wd.mwtd_jumlah)
        FROM tmutasi_workshop_hdr mwh
        JOIN tmwt_hdr twh ON twh.mwt_nokirim = mwh.mw_nomor
        JOIN tmwt_dtl wd  ON wd.mwtd_nomor   = twh.mwt_nomor
        WHERE FIND_IN_SET(h.sd_nomor, REPLACE(mwh.mw_so_dtf, ' ', ''))
          AND mwh.mw_noterima IS NOT NULL
          AND mwh.mw_noterima <> ''
      ), 0) AS masuk_workshop,

      b.tgl_pengerjaan,
      b.deadline,
      CASE 
        WHEN EXISTS (SELECT 1 FROM tdtf WHERE sodtf = h.sd_nomor) THEN 'Ready'
        ELSE IFNULL(b.status, 'Antri') 
      END AS status,
      b.alasan_pending
    FROM tsodtf_hdr h
    LEFT JOIN tdashboard_bordir b ON h.sd_nomor = b.so_nomor
    WHERE h.sd_nomor LIKE '%.BR.%'
      AND h.sd_tanggal BETWEEN ? AND ?
    ORDER BY h.sd_tanggal DESC, h.sd_nomor DESC
  `;

  const [rows] = await pool.query(query, [startDate, endDate]);
  return rows;
};

const updateBordirSchedule = async (payload, user) => {
  const { so_nomor, tgl_pengerjaan, deadline, status, alasan_pending } =
    payload;

  // Pastikan status yang dikirim bukan 'Ready' (karena Ready otomatis dari LHK)
  const finalStatus = status === "Ready" ? "Antri" : status || "Antri";

  const query = `
    INSERT INTO tdashboard_bordir (so_nomor, tgl_pengerjaan, deadline, status, alasan_pending, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      tgl_pengerjaan = VALUES(tgl_pengerjaan),
      deadline = VALUES(deadline),
      status = VALUES(status),
      alasan_pending = VALUES(alasan_pending),
      updated_by = VALUES(updated_by),
      updated_at = NOW()
  `;

  await pool.query(query, [
    so_nomor,
    tgl_pengerjaan || null,
    deadline || null,
    finalStatus,
    alasan_pending || "",
    user.kode,
  ]);

  return { message: "Status antrian bordir berhasil diperbarui." };
};

// =========================================================================
// FITUR 1: Analitik Penjualan Rendah (< 20 pcs) PER STORE
// =========================================================================
const getLowStockSales = async (user, filters = {}) => {
  const { period = "3m", cabang = "ALL", isExport = false } = filters;

  let startDate;
  const endDate = format(new Date(), "yyyy-MM-dd");

  switch (period) {
    case "6m":
      startDate = format(subMonths(new Date(), 6), "yyyy-MM-dd");
      break;
    case "1y":
      startDate = format(subYears(new Date(), 1), "yyyy-MM-dd");
      break;
    case "3m":
    default:
      startDate = format(subMonths(new Date(), 3), "yyyy-MM-dd");
      break;
  }

  let branchFilter = "";
  let params = [startDate, endDate];

  if (user.cabang !== "KDC") {
    branchFilter = "AND h.inv_cab = ?";
    params.push(user.cabang);
  } else if (cabang !== "ALL") {
    branchFilter = "AND h.inv_cab = ?";
    params.push(cabang);
  }

  const limitClause = isExport ? "" : "LIMIT 50";

  // LOGIKA BARU:
  // 1. Hitung total terjual
  // 2. Filter HAVING total_terjual < 20
  // 3. ORDER ASC (dari yang paling kecil / ga laku)
  // 4. Subquery stok untuk nampilin stok saat ini (tanpa jadi patokan filter)

  const query = `
    SELECT 
        h.inv_cab AS cabang_kode,
        IFNULL(g.gdg_nama, h.inv_cab) AS cabang_nama,
        d.invd_kode AS kode,
        TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), " ", IFNULL(a.brg_tipe,''), " ", IFNULL(a.brg_lengan,''), " ", IFNULL(a.brg_jeniskain,''), " ", IFNULL(a.brg_warna,''))) AS nama,
        d.invd_ukuran AS ukuran,
        IFNULL((
            SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
            FROM tmasterstok m 
            WHERE m.mst_aktif = 'Y' 
              AND m.mst_cab = h.inv_cab 
              AND m.mst_brg_kode = d.invd_kode 
              AND m.mst_ukuran = d.invd_ukuran
        ), 0) AS stok_sekarang,
        SUM(d.invd_jumlah) AS total_terjual
    FROM tinv_hdr h
    JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
    JOIN tbarangdc a ON a.brg_kode = d.invd_kode
    LEFT JOIN tgudang g ON g.gdg_kode = h.inv_cab
    WHERE h.inv_sts_pro = 0 
      AND h.inv_tanggal BETWEEN ? AND ?
      -- Filter agar murni barang jualan (Singkirkan Jasa & Stiker)
      AND a.brg_ktgp NOT IN ('JASA', 'BONUS', 'TANPA KATEGORI')
      AND d.invd_kode NOT LIKE 'JASA%'
      AND a.brg_warna NOT LIKE '%STICKER%'
      AND a.brg_jeniskaos NOT LIKE '%STIKER%'
      ${branchFilter}
    GROUP BY h.inv_cab, cabang_nama, d.invd_kode, nama, d.invd_ukuran
    HAVING total_terjual < 20
    ORDER BY total_terjual ASC, nama ASC
    ${limitClause}
  `;

  const [rows] = await pool.query(query, params);
  return rows;
};

// =========================================================================
// FITUR BARU 2: Analitik Penjualan Barang Sesional (New Arrival) PER STORE
// =========================================================================
const getSeasonalSales = async (user, filters = {}) => {
  const { period = "1m", cabang = "ALL", isExport = false } = filters;

  let startDate;
  const endDate = format(new Date(), "yyyy-MM-dd");

  switch (period) {
    case "1w":
      startDate = format(subWeeks(new Date(), 1), "yyyy-MM-dd");
      break;
    case "2w":
      startDate = format(subWeeks(new Date(), 2), "yyyy-MM-dd");
      break;
    case "2m":
      startDate = format(subMonths(new Date(), 2), "yyyy-MM-dd");
      break;
    case "1m":
    default:
      startDate = format(subMonths(new Date(), 1), "yyyy-MM-dd");
      break;
  }

  let branchFilter = "";
  let params = [startDate, endDate];

  if (user.cabang !== "KDC") {
    branchFilter = "AND h.inv_cab = ?";
    params.push(user.cabang);
  } else if (cabang !== "ALL") {
    branchFilter = "AND h.inv_cab = ?";
    params.push(cabang);
  }

  const limitClause = isExport ? "" : "LIMIT 20";

  const query = `
    SELECT 
        h.inv_cab AS cabang_kode,
        IFNULL(g.gdg_nama, h.inv_cab) AS cabang_nama,
        d.invd_kode AS kode,
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
        d.invd_ukuran AS ukuran,
        SUM(d.invd_jumlah) AS total_terjual
    FROM tinv_hdr h
    JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
    JOIN tbarangdc a ON a.brg_kode = d.invd_kode
    LEFT JOIN tgudang g ON g.gdg_kode = h.inv_cab
    WHERE h.inv_sts_pro = 0 
      AND h.inv_tanggal BETWEEN ? AND ?
      AND a.brg_ktgp IN ('SESIONAL', 'SESSIONAL')
      ${branchFilter}
    GROUP BY h.inv_cab, cabang_nama, d.invd_kode, nama, d.invd_ukuran
    ORDER BY total_terjual DESC
    ${limitClause}
  `;

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * @description Mengambil agenda dateline SO dan rincian item custom (DTF)
 */
const getAgendaDateline = async (user) => {
  let filterSo = "AND h.so_cab = ?";
  let params = [user.cabang];

  if (user.cabang === "KDC") {
    filterSo = "";
    params = [];
  }

  // OPTIMASI: Ganti Correlated Subquery dengan JOIN & GROUP BY di luar
  let query = `
    SELECT 
        'SO' as tipe, 
        h.so_nomor as nomor, 
        DATE_FORMAT(h.so_dateline, '%Y-%m-%d') as dateline, 
        c.cus_nama as customer,
        
        -- Cek apakah sudah jadi invoice
        IF(EXISTS(SELECT 1 FROM tinv_hdr WHERE inv_nomor_so = h.so_nomor AND inv_sts_pro = 0), 1, 0) AS is_completed,
        
        -- Cek scan ready
        IFNULL((
            SELECT IF(SUM(sod_jumlah) > 0 AND SUM(sod_scanned) >= SUM(sod_jumlah), 1, 0)
            FROM tso_dtl
            WHERE sod_so_nomor = h.so_nomor
        ), 0) AS is_scan_ready,

        -- Ambil rincian DTF menggunakan GROUP_CONCAT yang lebih efisien via JOIN di bawah
        GROUP_CONCAT(
            DISTINCT CASE 
                WHEN d.sod_custom_nama IS NOT NULL AND d.sod_custom_nama != '' THEN d.sod_custom_nama
                WHEN d.sod_sd_nomor IS NOT NULL AND d.sod_sd_nomor != '' THEN f.sd_nama
                ELSE NULL
            END 
            SEPARATOR ', '
        ) AS rincian_dtf

    FROM tso_hdr h 
    LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
    
    -- Lakukan LEFT JOIN langsung untuk mempermudah GROUP_CONCAT
    LEFT JOIN tso_dtl d ON d.sod_so_nomor = h.so_nomor AND d.sod_custom = 'Y'
    LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.sod_sd_nomor

    WHERE h.so_close = 0 
      AND h.so_dateline IS NOT NULL 
      AND h.so_cab <> 'KPR'
      ${filterSo}
    
    -- Wajib di-group per SO karena kita pakai GROUP_CONCAT di atas
    GROUP BY h.so_nomor, h.so_dateline, c.cus_nama
  `;

  // [BARU] Sisipkan SPK untuk user KDC
  if (user.cabang === "KDC") {
    query += `
      UNION ALL
      SELECT 
        'SPK' as tipe,
        spk_nomor as nomor,
        DATE_FORMAT(spk_dateline, '%Y-%m-%d') as dateline,
        CONCAT('[', IFNULL(spk_cabkaos, 'UMUM'), '] ', spk_nama) as customer,
        
        -- Gunakan EXISTS agar lebih ringan daripada COUNT
        IF(EXISTS(SELECT 1 FROM tdc_stbj_dtl WHERE tsd_spk_nomor = spk_nomor), 1, 0) AS is_completed,
        
        0 AS is_scan_ready,
        
        -- Ambil status pengerjaan riil sebagai rincian (Dari bawah ke atas)
        CASE
            WHEN EXISTS(SELECT 1 FROM tdc_stbj_dtl WHERE tsd_spk_nomor = spk_nomor) THEN 'Selesai (Diterima DC)'
            WHEN EXISTS(SELECT 1 FROM kencanaprint.tstbj_dtl WHERE stbjd_spk_nomor = spk_nomor) THEN 'Dikirim ke DC (STBJ)'
            WHEN EXISTS(SELECT 1 FROM kencanaprint.tmutasiproduksi_hdr WHERE mph_spk_nomor = spk_nomor AND mph_gdgasal = 'GP013') THEN 'Barang Jadi (Koli)'
            WHEN EXISTS(SELECT 1 FROM kencanaprint.tmutasiproduksi_hdr WHERE mph_spk_nomor = spk_nomor AND mph_gdgasal = 'GP004') THEN 'Proses Lipat'
            WHEN EXISTS(SELECT 1 FROM kencanaprint.tmutasiproduksi_hdr WHERE mph_spk_nomor = spk_nomor AND mph_gdgasal = 'GP003') THEN 'Proses Jahit'
            WHEN EXISTS(SELECT 1 FROM kencanaprint.tmutasiproduksi_hdr WHERE mph_spk_nomor = spk_nomor AND mph_gdgasal = 'GP002') THEN 'Proses Cetak'
            WHEN EXISTS(SELECT 1 FROM kencanaprint.tmutasiproduksi_hdr WHERE mph_spk_nomor = spk_nomor AND mph_gdgasal = 'GP001') THEN 'Proses Potong'
            WHEN EXISTS(SELECT 1 FROM kencanaprint.tproduksiminta_hdr WHERE promin_spk_nomor = spk_nomor) THEN 'Bahan Dikeluarkan'
            WHEN EXISTS(SELECT 1 FROM kencanaprint.tmintabahan_hdr WHERE min_spk_nomor = spk_nomor) THEN 'Permintaan Bahan'
            ELSE 'Menunggu Produksi'
        END AS rincian_dtf
      FROM kencanaprint.tspk
      WHERE spk_divisi = 3 
        AND spk_close = 0 
        AND spk_dateline IS NOT NULL 
    `;
  }

  const finalQuery = `
    SELECT * FROM (
      SELECT * FROM (${query}) AS combined_agenda
      WHERE is_completed = 0
        -- Buang deadline yang sudah lewat lebih dari 7 hari — kemungkinan
        -- besar data lama yang tidak pernah ditutup (so_close tetap 0),
        -- bukan "deadline terdekat" yang beneran perlu ditindaklanjuti hari ini.
        AND dateline >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    ) AS filtered_agenda
    ORDER BY dateline ASC;
  `;

  const [rows] = await pool.query(finalQuery, params);
  return rows;
};

const getDeadStockSummary = async (user, filters = {}) => {
  const { cabang = "ALL" } = filters;

  let branchFilter = "";
  let params = [];

  if (user.cabang !== "KDC") {
    branchFilter = "AND m.mst_cab = ?";
    params.push(user.cabang);
  } else if (cabang !== "ALL") {
    branchFilter = "AND m.mst_cab = ?";
    params.push(cabang);
  }

  // Ambil data stok dengan usia (dari last terima STBJ)
  const query = `
    SELECT 
      IFNULL(
        FLOOR(DATEDIFF(CURDATE(), b.last_tstbj) / 30),
        IFNULL(FLOOR(DATEDIFF(CURDATE(), a.date_create) / 30), 999)
      ) AS umur_bulan,
      SUM(x.stok) AS stok,
      SUM(x.stok * IFNULL(dtl.brgd_hpp, 0)) AS nilai
    FROM (
      SELECT mst_brg_kode, mst_ukuran, mst_cab,
        SUM(mst_stok_in - mst_stok_out) AS stok
      FROM (
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif 
        FROM tmasterstok
        UNION ALL
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif 
        FROM tmasterstokso
      ) m
      WHERE m.mst_aktif = 'Y' ${branchFilter}
      GROUP BY mst_brg_kode, mst_ukuran, mst_cab
      HAVING stok > 0
    ) x
    LEFT JOIN tbarangdc a ON a.brg_kode = x.mst_brg_kode
    LEFT JOIN tbarangdc_dtl dtl ON dtl.brgd_kode = x.mst_brg_kode 
      AND dtl.brgd_ukuran = x.mst_ukuran
    LEFT JOIN (
      SELECT LEFT(tjd_nomor, 3) AS cab, 
            tjd_kode AS kode, 
            tjd_ukuran AS ukuran,
            MAX(tj_tanggal) AS last_tstbj
      FROM ttrm_sj_hdr
      INNER JOIN ttrm_sj_dtl ON tjd_nomor = tj_nomor
      GROUP BY 1, 2, 3

      UNION ALL

      SELECT 'KDC' AS cab,
            tsd_kode AS kode,
            tsd_ukuran AS ukuran,
            MAX(ts_tanggal) AS last_tstbj
      FROM tdc_stbj_hdr
      INNER JOIN tdc_stbj_dtl ON tsd_nomor = ts_nomor
      GROUP BY 1, 2, 3
    ) b ON b.cab = x.mst_cab
      AND b.kode = x.mst_brg_kode
      AND b.ukuran = x.mst_ukuran
    WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
      AND a.brg_warna NOT LIKE '%STICKER%'
      AND a.brg_warna NOT LIKE '%STIKER%'
      AND a.brg_warna NOT LIKE '%DTF%'
      AND a.brg_kode NOT LIKE 'JASA%'
    GROUP BY umur_bulan
  `;

  const [rows] = await pool.query(query, params);

  // Klasifikasi ke 4 tier
  const result = {
    fm: 0,
    std: 0,
    sm: 0,
    ds: 0,
    nilaiFm: 0,
    nilaiStd: 0,
    nilaySm: 0,
    nilaiDs: 0,
    total: 0,
    nilaiTotal: 0,
  };

  rows.forEach((r) => {
    const bln = Number(r.umur_bulan);
    const stok = Number(r.stok);
    const nilai = Number(r.nilai);
    result.total += stok;
    result.nilaiTotal += nilai;
    if (bln <= 6) {
      result.fm += stok;
      result.nilaiFm += nilai;
    } else if (bln <= 12) {
      result.std += stok;
      result.nilaiStd += nilai;
    } else if (bln <= 24) {
      result.sm += stok;
      result.nilaySm += nilai;
    } else {
      result.ds += stok;
      result.nilaiDs += nilai;
    }
  });

  return result;
};

const getDeadStockChart = async (user, filters = {}) => {
  const { cabang = "ALL" } = filters;

  let branchFilter = "";
  let params = [];

  if (user.cabang !== "KDC") {
    branchFilter = "AND m.mst_cab = ?";
    params.push(user.cabang);
  } else if (cabang !== "ALL") {
    branchFilter = "AND m.mst_cab = ?";
    params.push(cabang);
  }

  const query = `
    SELECT 
      kategori,
      SUM(CASE WHEN umur_bulan <= 6  THEN stok ELSE 0 END) AS fm,
      SUM(CASE WHEN umur_bulan > 6  AND umur_bulan <= 12 THEN stok ELSE 0 END) AS std,
      SUM(CASE WHEN umur_bulan > 12 AND umur_bulan <= 24 THEN stok ELSE 0 END) AS sm,
      SUM(CASE WHEN umur_bulan > 24 THEN stok ELSE 0 END) AS ds
    FROM (
      SELECT
        IFNULL(NULLIF(TRIM(a.brg_jeniskain), ''), 'LAIN-LAIN') AS kategori,
        IFNULL(
          FLOOR(DATEDIFF(CURDATE(), b.last_tstbj) / 30),
          IFNULL(FLOOR(DATEDIFF(CURDATE(), a.date_create) / 30), 999)
        ) AS umur_bulan,
        x.stok
      FROM (
        SELECT mst_brg_kode, mst_ukuran, mst_cab,
          SUM(mst_stok_in - mst_stok_out) AS stok
        FROM (
          SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif 
          FROM tmasterstok
          UNION ALL
          SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif 
          FROM tmasterstokso
        ) m
        WHERE m.mst_aktif = 'Y' ${branchFilter}
        GROUP BY mst_brg_kode, mst_ukuran, mst_cab
        HAVING SUM(mst_stok_in - mst_stok_out) > 0
      ) x
      LEFT JOIN tbarangdc a ON a.brg_kode = x.mst_brg_kode
      LEFT JOIN (
        SELECT LEFT(tjd_nomor, 3) AS cab, 
              tjd_kode AS kode, 
              tjd_ukuran AS ukuran,
              MAX(tj_tanggal) AS last_tstbj
        FROM ttrm_sj_hdr
        INNER JOIN ttrm_sj_dtl ON tjd_nomor = tj_nomor
        GROUP BY 1, 2, 3

        UNION ALL

        SELECT 'KDC' AS cab,
              tsd_kode AS kode,
              tsd_ukuran AS ukuran,
              MAX(ts_tanggal) AS last_tstbj
        FROM tdc_stbj_hdr
        INNER JOIN tdc_stbj_dtl ON tsd_nomor = ts_nomor
        GROUP BY 1, 2, 3
      ) b ON b.cab = x.mst_cab
        AND b.kode = x.mst_brg_kode
        AND b.ukuran = x.mst_ukuran
      WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
        AND a.brg_warna NOT LIKE '%STICKER%'
        AND a.brg_warna NOT LIKE '%STIKER%'
        AND a.brg_warna NOT LIKE '%DTF%'
        AND a.brg_kode NOT LIKE 'JASA%'
    ) base
    GROUP BY kategori
    ORDER BY SUM(stok) DESC
    LIMIT 10
  `;

  const [rows] = await pool.query(query, params);
  return rows;
};

const getDeadStockSalesPie = async (user, filters = {}) => {
  const { cabang = "ALL" } = filters;

  let branchFilter = "";
  let salesBranchFilter = "";
  let params = [];
  let salesParams = [];

  if (user.cabang !== "KDC") {
    branchFilter = "AND m.mst_cab = ?";
    salesBranchFilter = "AND h.inv_cab = ?";
    params.push(user.cabang);
    salesParams.push(user.cabang);
  } else if (cabang !== "ALL") {
    branchFilter = "AND m.mst_cab = ?";
    salesBranchFilter = "AND h.inv_cab = ?";
    params.push(cabang);
    salesParams.push(cabang);
  }

  // Ambil SKU dead stock (umur > 24 bulan) lalu cek apakah terjual 12 bln terakhir
  const query = `
    SELECT
      SUM(CASE WHEN sls.total_terjual > 0 THEN x.stok ELSE 0 END) AS stok_terjual,
      SUM(CASE WHEN sls.total_terjual IS NULL OR sls.total_terjual = 0 THEN x.stok ELSE 0 END) AS stok_tidak_terjual,
      SUM(CASE WHEN sls.total_terjual > 0 THEN sls.total_terjual ELSE 0 END) AS qty_terjual,
      COUNT(DISTINCT CASE WHEN sls.total_terjual > 0 THEN CONCAT(x.mst_brg_kode, '-', x.mst_ukuran) END) AS sku_bergerak,
      COUNT(DISTINCT CONCAT(x.mst_brg_kode, '-', x.mst_ukuran)) AS sku_total
    FROM (
      SELECT mst_brg_kode, mst_ukuran, mst_cab,
        SUM(mst_stok_in - mst_stok_out) AS stok
      FROM (
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif
        FROM tmasterstok
        UNION ALL
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif
        FROM tmasterstokso
      ) m
      WHERE m.mst_aktif = 'Y' ${branchFilter}
      GROUP BY mst_brg_kode, mst_ukuran, mst_cab
      HAVING SUM(mst_stok_in - mst_stok_out) > 0
    ) x
    LEFT JOIN tbarangdc a ON a.brg_kode = x.mst_brg_kode
    LEFT JOIN (
      SELECT LEFT(tjd_nomor, 3) AS cab, tjd_kode AS kode, tjd_ukuran AS ukuran,
        MAX(tj_tanggal) AS last_tstbj
      FROM ttrm_sj_hdr
      INNER JOIN ttrm_sj_dtl ON tjd_nomor = tj_nomor
      GROUP BY 1, 2, 3
      UNION ALL
      SELECT 'KDC' AS cab, tsd_kode AS kode, tsd_ukuran AS ukuran,
        MAX(ts_tanggal) AS last_tstbj
      FROM tdc_stbj_hdr
      INNER JOIN tdc_stbj_dtl ON tsd_nomor = ts_nomor
      GROUP BY 1, 2, 3
    ) b ON b.cab = x.mst_cab
      AND b.kode = x.mst_brg_kode
      AND b.ukuran = x.mst_ukuran
    LEFT JOIN (
      SELECT d.invd_kode, d.invd_ukuran,
        SUM(d.invd_jumlah) AS total_terjual
      FROM tinv_dtl d
      JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
      WHERE h.inv_sts_pro = 0
        AND h.inv_tanggal >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        ${salesBranchFilter}
      GROUP BY d.invd_kode, d.invd_ukuran
    ) sls ON sls.invd_kode = x.mst_brg_kode
      AND sls.invd_ukuran = x.mst_ukuran
    WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
      AND a.brg_warna NOT LIKE '%STICKER%'
      AND a.brg_warna NOT LIKE '%STIKER%'
      AND a.brg_warna NOT LIKE '%DTF%'
      AND IFNULL(FLOOR(DATEDIFF(CURDATE(), b.last_tstbj) / 30), 999) > 24
  `;

  const allParams = [...params, ...salesParams];
  const [rows] = await pool.query(query, allParams);
  return rows[0] || {};
};

const getDeadStockSalesDetail = async (user, filters = {}) => {
  const { cabang = "ALL", tipe = "bergerak" } = filters; // tipe: bergerak | stagnan

  let branchFilter = "";
  let salesBranchFilter = "";
  let params = [];
  let salesParams = [];

  if (user.cabang !== "KDC") {
    branchFilter = "AND m.mst_cab = ?";
    salesBranchFilter = "AND h.inv_cab = ?";
    params.push(user.cabang);
    salesParams.push(user.cabang);
  } else if (cabang !== "ALL") {
    branchFilter = "AND m.mst_cab = ?";
    salesBranchFilter = "AND h.inv_cab = ?";
    params.push(cabang);
    salesParams.push(cabang);
  }

  const havingClause =
    tipe === "bergerak" ? "WHERE total_terjual > 0" : "WHERE total_terjual = 0";

  const query = `
  SELECT * FROM (
    SELECT
      x.mst_brg_kode AS kode,
      TRIM(CONCAT(a.brg_jeniskaos,' ',a.brg_tipe,' ',a.brg_lengan,' ',a.brg_jeniskain,' ',a.brg_warna)) AS nama,
      x.mst_ukuran AS ukuran,
      a.brg_jeniskain AS jenis_kain,
      x.mst_cab AS cabang,
      x.stok,
      IFNULL(
        FLOOR(DATEDIFF(CURDATE(), b.last_tstbj) / 30),
        IFNULL(FLOOR(DATEDIFF(CURDATE(), a.date_create) / 30), 999)
      ) AS umur_bulan,
      b.last_tstbj,
      IFNULL(sls.total_terjual, 0) AS total_terjual,
      IFNULL(dtl.brgd_hpp, 0) AS hpp,
      x.stok * IFNULL(dtl.brgd_hpp, 0) AS nilai_stok
    FROM (
      SELECT mst_brg_kode, mst_ukuran, mst_cab,
        SUM(mst_stok_in - mst_stok_out) AS stok
      FROM (
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif
        FROM tmasterstok
        UNION ALL
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif
        FROM tmasterstokso
      ) m
      WHERE m.mst_aktif = 'Y' ${branchFilter}
      GROUP BY mst_brg_kode, mst_ukuran, mst_cab
      HAVING SUM(mst_stok_in - mst_stok_out) > 0
    ) x
    LEFT JOIN tbarangdc a ON a.brg_kode = x.mst_brg_kode
    LEFT JOIN tbarangdc_dtl dtl ON dtl.brgd_kode = x.mst_brg_kode
      AND dtl.brgd_ukuran = x.mst_ukuran
    LEFT JOIN (
      SELECT LEFT(tjd_nomor, 3) AS cab, tjd_kode AS kode, tjd_ukuran AS ukuran,
        MAX(tj_tanggal) AS last_tstbj
      FROM ttrm_sj_hdr
      INNER JOIN ttrm_sj_dtl ON tjd_nomor = tj_nomor
      GROUP BY 1, 2, 3
      UNION ALL
      SELECT 'KDC' AS cab, tsd_kode AS kode, tsd_ukuran AS ukuran,
        MAX(ts_tanggal) AS last_tstbj
      FROM tdc_stbj_hdr
      INNER JOIN tdc_stbj_dtl ON tsd_nomor = ts_nomor
      GROUP BY 1, 2, 3
    ) b ON b.cab = x.mst_cab
      AND b.kode = x.mst_brg_kode
      AND b.ukuran = x.mst_ukuran
    LEFT JOIN (
      SELECT d.invd_kode, d.invd_ukuran,
        SUM(d.invd_jumlah) AS total_terjual
      FROM tinv_dtl d
      JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
      WHERE h.inv_sts_pro = 0
        AND h.inv_tanggal >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        ${salesBranchFilter}
      GROUP BY d.invd_kode, d.invd_ukuran
    ) sls ON sls.invd_kode = x.mst_brg_kode
      AND sls.invd_ukuran = x.mst_ukuran
    WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
      AND a.brg_warna NOT LIKE '%STICKER%'
      AND a.brg_warna NOT LIKE '%STIKER%'
      AND a.brg_warna NOT LIKE '%DTF%'
      AND a.brg_kode NOT LIKE 'JASA%'
      AND IFNULL(FLOOR(DATEDIFF(CURDATE(), b.last_tstbj) / 30), 999) > 24
  ) hasil
  ${havingClause}
  ORDER BY nilai_stok DESC
`;

  const allParams = [...params, ...salesParams];
  const [rows] = await pool.query(query, allParams);
  return rows;
};

const getSpkPendingApproval = async (filters = {}) => {
  const { startDate, endDate } = filters;

  const start = startDate || format(subDays(new Date(), 7), "yyyy-MM-dd");
  const end = endDate || format(new Date(), "yyyy-MM-dd");

  const query = `
    SELECT 
      h.spk_nomor,
      DATE_FORMAT(h.spk_tanggal, '%Y-%m-%d') AS spk_tanggal,
      h.spk_nama AS nama_desain,
      h.spk_jumlah AS jumlah,
      IFNULL(g.gdg_nama, IFNULL(u.user_cab, h.spk_cabkaos)) AS cabang,
      h.spk_statuskerja AS status_kerja, 
      h.spk_ketpending AS ket_pending,
      h.user_create,
      DATE_FORMAT(h.spk_dateline, '%Y-%m-%d') AS spk_dateline,
      h.spk_keterangan,
      h.spk_cmo
    FROM kencanaprint.tspk h
    LEFT JOIN tuser u ON u.user_kode = h.user_create
    LEFT JOIN tgudang g ON g.gdg_kode = IFNULL(u.user_cab, h.spk_cabkaos)
    WHERE h.spk_divisi = 3
      AND h.spk_close = 0
      AND h.spk_alokasi <> 'Y'
      AND h.user_create NOT IN ('ADIN', 'LUTFI')
      AND TRIM(IFNULL(h.spk_cmo, '')) = ''
      AND DATE(h.spk_tanggal) BETWEEN ? AND ?
    ORDER BY h.spk_tanggal DESC, h.spk_nomor DESC
  `;

  const [rows] = await pool.query(query, [start, end]);
  return rows;
};

const getAutoMintaAnalytics = async (user, filters = {}) => {
  const { cabang = "ALL", startDate, endDate } = filters;

  // Default filter 1 bulan terakhir jika tidak dikirim dari frontend
  const start = startDate || format(startOfMonth(new Date()), "yyyy-MM-dd");
  const end = endDate || format(endOfMonth(new Date()), "yyyy-MM-dd");

  let branchFilter = "";
  let params = [start, end];

  if (user.cabang !== "KDC") {
    branchFilter = "AND mt_cab = ?";
    params.push(user.cabang);
  } else if (cabang !== "ALL") {
    branchFilter = "AND mt_cab = ?";
    params.push(cabang);
  }

  // Menggunakan CTE (WITH) agar query dieksekusi secara bulk dan SANGAT CEPAT
  const query = `
    WITH TargetHeaders AS (
        SELECT mt_nomor, mt_cab
        FROM tmintabarang_hdr
        WHERE mt_otomatis = 'Y' 
          AND DATE(mt_tanggal) BETWEEN ? AND ?
          ${branchFilter}
    ),
    ReqQty AS (
        SELECT h.mt_cab, SUM(d.mtd_jumlah) as qty_minta
        FROM TargetHeaders h
        JOIN tmintabarang_dtl d ON h.mt_nomor = d.mtd_nomor
        GROUP BY h.mt_cab
    ),
    PackedQty AS (
        SELECT h.mt_cab, SUM(pld.pld_jumlah) as qty_packed
        FROM TargetHeaders h
        JOIN tpacking_list_hdr plh ON plh.pl_mt_nomor = h.mt_nomor
        JOIN tpacking_list_dtl pld ON pld.pld_nomor = plh.pl_nomor
        GROUP BY h.mt_cab
    ),
    TargetSJ AS (
        SELECT 
            h.mt_cab,
            COALESCE(NULLIF(pl.pl_sj_nomor, ''), sj.sj_nomor) AS final_sj_nomor
        FROM TargetHeaders h
        LEFT JOIN tpacking_list_hdr pl ON pl.pl_mt_nomor = h.mt_nomor
        LEFT JOIN tdc_sj_hdr sj ON sj.sj_mt_nomor = h.mt_nomor
    ),
    SentQty AS (
        SELECT t.mt_cab, SUM(sjd.sjd_jumlah) AS qty_sent
        FROM TargetSJ t
        JOIN tdc_sj_dtl sjd ON sjd.sjd_nomor = t.final_sj_nomor
        WHERE t.final_sj_nomor IS NOT NULL AND t.final_sj_nomor != ''
        GROUP BY t.mt_cab
    )
    SELECT 
        th.mt_cab AS kode_cabang,
        g.gdg_nama AS nama_cabang,
        IFNULL(rq.qty_minta, 0) AS qty_minta,
        IFNULL(pq.qty_packed, 0) AS qty_packed,
        IFNULL(sq.qty_sent, 0) AS qty_sent
    FROM (SELECT DISTINCT mt_cab FROM TargetHeaders) th
    LEFT JOIN tgudang g ON g.gdg_kode = th.mt_cab
    LEFT JOIN ReqQty rq ON rq.mt_cab = th.mt_cab
    LEFT JOIN PackedQty pq ON pq.mt_cab = th.mt_cab
    LEFT JOIN SentQty sq ON sq.mt_cab = th.mt_cab
    ORDER BY th.mt_cab ASC;
  `;

  const [rows] = await pool.query(query, params);

  // Kalkulasi Rasio Efisiensi Pemenuhan di Sisi Node.js
  const processedData = rows.map((row) => {
    const qtyMinta = Number(row.qty_minta) || 0;
    const qtyPacked = Number(row.qty_packed) || 0;
    const qtySent = Number(row.qty_sent) || 0;

    return {
      ...row,
      ratio_packing:
        qtyMinta > 0 ? Number(((qtyPacked / qtyMinta) * 100).toFixed(1)) : 0,
      ratio_sj:
        qtyMinta > 0 ? Number(((qtySent / qtyMinta) * 100).toFixed(1)) : 0,
    };
  });

  return processedData;
};

// =========================================================================
// FITUR BARU: Lihat Stok Real Toko (Fisik - Pesanan) -> Infinite Scroll & Smart Search
// =========================================================================
const getRealStockList = async (user, filters = {}) => {
  // Tangkap parameter page dan limit untuk infinite scroll (default: page 1, limit 50)
  const {
    cabang = "ALL",
    search = "",
    ukuran = "",
    page = 1,
    limit = 50,
  } = filters;
  let branchFilter = "";
  let params = [];

  // 1. Penentuan Filter Cabang
  if (user.cabang !== "KDC") {
    branchFilter = "AND m.mst_cab = ?";
    params.push(user.cabang);
  } else if (cabang !== "ALL") {
    branchFilter = "AND m.mst_cab = ?";
    params.push(cabang);
  }

  // 2. Filter Pencarian Cerdas (Smart Search Tokenization)
  const tokens = (search || "")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  let searchFilter = "";

  if (tokens.length > 0) {
    searchFilter += " AND (";
    const likeParts = [];

    for (const t of tokens) {
      likeParts.push(`
        (
          a.brg_kode LIKE ?
          OR TRIM(CONCAT(
            IFNULL(a.brg_jeniskaos,''), ' ', 
            IFNULL(a.brg_tipe,''), ' ', 
            IFNULL(a.brg_lengan,''), ' ', 
            IFNULL(a.brg_jeniskain,''), ' ', 
            IFNULL(a.brg_warna,'')
          )) LIKE ?
        )
      `);

      const likeVal = `%${t}%`;
      // Push 2 parameter untuk setiap token (1 untuk kode, 1 untuk nama lengkap)
      params.push(likeVal, likeVal);
    }

    // Semua potongan kata (token) wajib match
    searchFilter += likeParts.join(" AND ");
    searchFilter += ")";
  }
  // [BARU] Filter ukuran spesifik — dipisah dari searchFilter karena ukuran
  // bukan bagian dari nama barang gabungan (jeniskaos+tipe+lengan+jeniskain+warna),
  // dia field kolom tersendiri (mst_ukuran). Kalau digabung ke search, query
  // LIKE tidak akan pernah match apapun.
  let ukuranFilter = "";
  if (ukuran && ukuran.trim() !== "") {
    ukuranFilter = "AND m.mst_ukuran = ?";
    params.push(ukuran.trim().toUpperCase());
  }
  // 3. Setup Kalkulasi Offset untuk Pagination/Infinite Scroll
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 50;
  const offset = (pageNum - 1) * limitNum;

  // 4. Query Pengambilan Stok Real
  const query = `
    WITH open_so AS (
      SELECT Nomor
      FROM (
        SELECT
          y.Nomor,
          CASE
            WHEN y.sts <> 0 THEN 'DICLOSE'
            WHEN y.StatusKirim = 'TERKIRIM' THEN 'CLOSE'
            WHEN y.StatusKirim = 'BELUM'
                AND y.keluar = 0
                AND y.minta = ''
                AND y.pesan = 0
              THEN 'OPEN'
            ELSE 'PROSES'
          END AS StatusFinal
        FROM (
          SELECT
            x.*,
            IF(
              x.QtyInv = 0,
              'BELUM',
              IF(x.QtyInv >= x.QtySO, 'TERKIRIM', 'SEBAGIAN')
            ) AS StatusKirim,

            IFNULL((
              SELECT SUM(m.mst_stok_out)
              FROM tmasterstok m
              WHERE m.mst_noreferensi IN (
                SELECT o.mo_nomor
                FROM tmutasiout_hdr o
                WHERE o.mo_so_nomor = x.Nomor
              )
            ), 0) AS keluar,

            IFNULL((
              SELECT mt_nomor
              FROM tmintabarang_hdr
              WHERE mt_so = x.Nomor
              LIMIT 1
            ), '') AS minta,

            IFNULL((
              SELECT SUM(mst_stok_in - mst_stok_out)
              FROM tmasterstokso
              WHERE mst_aktif = 'Y'
                AND mst_nomor_so = x.Nomor
            ), 0) AS pesan

          FROM (
            SELECT
              h.so_nomor AS Nomor,
              h.so_close AS sts,

              IFNULL((
                SELECT SUM(dd.sod_jumlah)
                FROM tso_dtl dd
                WHERE dd.sod_so_nomor = h.so_nomor
              ), 0) AS QtySO,

              IFNULL((
                SELECT SUM(dd.invd_jumlah)
                FROM tinv_hdr hh
                JOIN tinv_dtl dd
                  ON dd.invd_inv_nomor = hh.inv_nomor
                WHERE hh.inv_sts_pro = 0
                  AND hh.inv_nomor_so = h.so_nomor
              ), 0) AS QtyInv

            FROM tso_hdr h
            WHERE h.so_close = 0
              AND h.so_aktif = 'Y'
          ) x
        ) y
      ) z
      WHERE z.StatusFinal = 'OPEN'
    )
    
    ,
    so_summary AS (
      SELECT
        h.so_cab,
        d.sod_kode,
        d.sod_ukuran,

        SUM(
          d.sod_jumlah - IFNULL(d.sod_scanned,0)
        ) AS pesanan_proses,

        GROUP_CONCAT(
          CONCAT(
            h.so_nomor,
            ' (',
            IFNULL(c.cus_nama,'-'),
            ') - ',
            (d.sod_jumlah - IFNULL(d.sod_scanned,0)),
            ' pcs'
          )
          ORDER BY h.so_nomor
          SEPARATOR '<br>'
        ) AS detail_pesanan_proses

      FROM open_so os
      JOIN tso_hdr h
        ON h.so_nomor = os.Nomor
      JOIN tso_dtl d
        ON d.sod_so_nomor = h.so_nomor
      LEFT JOIN tcustomer c
        ON c.cus_kode = h.so_cus_kode

      WHERE d.sod_jumlah > IFNULL(d.sod_scanned,0)

      GROUP BY
        h.so_cab,
        d.sod_kode,
        d.sod_ukuran
    ),

    otw_summary AS (

      SELECT
        cabang,
        kode,
        ukuran,

        SUM(qty) AS sudah_minta,

        GROUP_CONCAT(
          CONCAT(
            sumber,
            ' : ',
            nomor,
            ' - ',
            qty,
            ' pcs'
          )
          SEPARATOR '<br>'
        ) AS detail_sudah_minta

      FROM (

        SELECT
          h.mt_cab AS cabang,
          d.mtd_kode AS kode,
          d.mtd_ukuran AS ukuran,
          h.mt_nomor AS nomor,
          SUM(d.mtd_jumlah) AS qty,
          'Minta Barang' AS sumber
        FROM tmintabarang_hdr h
        JOIN tmintabarang_dtl d
          ON d.mtd_nomor = h.mt_nomor
        WHERE h.mt_closing='N'
          AND h.mt_close='N'
        GROUP BY
          h.mt_cab,
          d.mtd_kode,
          d.mtd_ukuran,
          h.mt_nomor

        UNION ALL

        SELECT
          h.pl_cab_tujuan,
          d.pld_kode,
          d.pld_ukuran,
          h.pl_nomor,
          SUM(d.pld_jumlah),
          'Packing List'
        FROM tpacking_list_hdr h
        JOIN tpacking_list_dtl d
          ON d.pld_nomor = h.pl_nomor
        WHERE h.pl_status='O'
        GROUP BY
          h.pl_cab_tujuan,
          d.pld_kode,
          d.pld_ukuran,
          h.pl_nomor

        UNION ALL

        SELECT
          h.sj_kecab,
          d.sjd_kode,
          d.sjd_ukuran,
          h.sj_nomor,
          SUM(d.sjd_jumlah),
          'Surat Jalan'
        FROM tdc_sj_hdr h
        JOIN tdc_sj_dtl d
          ON d.sjd_nomor = h.sj_nomor
        WHERE h.sj_noterima=''
        GROUP BY
          h.sj_kecab,
          d.sjd_kode,
          d.sjd_ukuran,
          h.sj_nomor

      ) x

      GROUP BY
        cabang,
        kode,
        ukuran
    )

    SELECT
      m.mst_cab AS cabang,
      a.brg_kode AS kode,

      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,

      m.mst_ukuran AS ukuran,

      SUM(
        CASE
          WHEN m.sumber='RAK'
          THEN (m.mst_stok_in-m.mst_stok_out)
          ELSE 0
        END
      ) AS stok_fisik,

      SUM(
        CASE
          WHEN m.sumber='SO'
          THEN (m.mst_stok_in-m.mst_stok_out)
          ELSE 0
        END
      ) AS stok_pesanan,

    IFNULL(so.pesanan_proses,0) AS pesanan_proses,

    IFNULL(otw.sudah_minta,0) AS sudah_minta,
       
    IFNULL(otw.detail_sudah_minta,'') AS detail_sudah_minta,

    IFNULL(so.detail_pesanan_proses,'') AS detail_pesanan_proses,

      (
        SUM(
          CASE
            WHEN m.sumber='RAK'
            THEN (m.mst_stok_in-m.mst_stok_out)
            ELSE 0
          END
        )
        -
        SUM(
          CASE
            WHEN m.sumber='SO'
            THEN (m.mst_stok_in-m.mst_stok_out)
            ELSE 0
          END
        )
      ) AS stok_real

    FROM (
      SELECT
        mst_brg_kode,
        mst_ukuran,
        mst_stok_in,
        mst_stok_out,
        mst_cab,
        'RAK' AS sumber
      FROM tmasterstok
      WHERE mst_aktif='Y'

      UNION ALL

      SELECT
        mst_brg_kode,
        mst_ukuran,
        mst_stok_in,
        mst_stok_out,
        mst_cab,
        'SO' AS sumber
      FROM tmasterstokso
      WHERE mst_aktif='Y'
    ) m

    JOIN tbarangdc a
      ON a.brg_kode = m.mst_brg_kode

    LEFT JOIN so_summary so
      ON so.so_cab = m.mst_cab
    AND so.sod_kode = a.brg_kode
    AND so.sod_ukuran = m.mst_ukuran

    LEFT JOIN otw_summary otw
      ON otw.cabang = m.mst_cab
    AND otw.kode = a.brg_kode
    AND otw.ukuran = m.mst_ukuran

    WHERE 1=1
      ${branchFilter}
      ${searchFilter}
      ${ukuranFilter}
      AND a.brg_aktif = 0
      AND a.brg_logstok = 'Y'
      AND a.brg_kode NOT LIKE 'JASA%'

    GROUP BY
      m.mst_cab,
      a.brg_kode,
      nama,
      m.mst_ukuran

    HAVING
      stok_fisik > 0
      OR stok_pesanan > 0
      OR pesanan_proses > 0

    ORDER BY
      stok_real ASC,
      nama ASC

    LIMIT ? OFFSET ?
  `;

  // 5. Push parameter untuk Limit dan Offset di urutan paling akhir
  params.push(limitNum, offset);

  const [rows] = await pool.query(query, params);
  return rows;
};

// =========================================================================
// FITUR BARU: Stok Kosong dari Barang Fast Moving
// (Barang yang terakhir diterima ≤6 bulan lalu, tapi stok sekarang 0/habis)
// =========================================================================
const getStokKosongFastMoving = async (user, filters = {}) => {
  const { cabang = "ALL", page = 1, limit = 50, exportAll = false } = filters;

  let branchFilterStok = "";
  let branchFilterRecv = "";
  const params = [];

  if (user.cabang !== "KDC") {
    branchFilterStok = "AND m.mst_cab = ?";
    branchFilterRecv = "AND b.cab = ?";
    params.push(user.cabang, user.cabang);
  } else if (cabang !== "ALL") {
    branchFilterStok = "AND m.mst_cab = ?";
    branchFilterRecv = "AND b.cab = ?";
    params.push(cabang, cabang);
  }

  // [BARU] Tambah LIMIT/OFFSET kecuali saat export (ambil semua)
  let paginationSql = "";
  if (!exportAll) {
    const offset = (Number(page) - 1) * Number(limit);
    paginationSql = `LIMIT ${Number(limit)} OFFSET ${offset}`;
    params.push(); // tidak perlu push apapun, LIMIT/OFFSET langsung di-inject sebagai number aman
  }

  const query = `
    WITH received AS (
      SELECT LEFT(tjd_nomor, 3) AS cab,
             tjd_kode AS kode,
             tjd_ukuran AS ukuran,
             MAX(tj_tanggal) AS last_tstbj
      FROM ttrm_sj_hdr
      INNER JOIN ttrm_sj_dtl ON tjd_nomor = tj_nomor
      GROUP BY 1, 2, 3

      UNION ALL

      SELECT 'KDC' AS cab,
             tsd_kode AS kode,
             tsd_ukuran AS ukuran,
             MAX(ts_tanggal) AS last_tstbj
      FROM tdc_stbj_hdr
      INNER JOIN tdc_stbj_dtl ON tsd_nomor = ts_nomor
      GROUP BY 1, 2, 3
    ),
    current_stock AS (
      SELECT mst_brg_kode, mst_ukuran, mst_cab,
        SUM(mst_stok_in - mst_stok_out) AS stok
      FROM (
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif
        FROM tmasterstok
        UNION ALL
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif
        FROM tmasterstokso
      ) m
      WHERE m.mst_aktif = 'Y' ${branchFilterStok}
      GROUP BY mst_brg_kode, mst_ukuran, mst_cab
    )
    SELECT
      b.cab AS cabang,
      IFNULL(g.gdg_nama, b.cab) AS nama_cabang,
      b.kode,
      TRIM(CONCAT(a.brg_jeniskaos,' ',a.brg_tipe,' ',a.brg_lengan,' ',a.brg_jeniskain,' ',a.brg_warna)) AS nama,
      b.ukuran,
      b.last_tstbj,
      FLOOR(DATEDIFF(CURDATE(), b.last_tstbj) / 30) AS umur_bulan,
      IFNULL(cs.stok, 0) AS stok_sekarang
    FROM received b
    LEFT JOIN current_stock cs
      ON cs.mst_brg_kode = b.kode
      AND cs.mst_ukuran = b.ukuran
      AND cs.mst_cab = b.cab
    LEFT JOIN tbarangdc a ON a.brg_kode = b.kode
    LEFT JOIN tgudang g ON g.gdg_kode = b.cab
    WHERE FLOOR(DATEDIFF(CURDATE(), b.last_tstbj) / 30) <= 6
      AND IFNULL(cs.stok, 0) <= 0
      AND a.brg_aktif = 0
      AND a.brg_logstok = 'Y'
      AND a.brg_warna NOT LIKE '%STICKER%'
      AND a.brg_warna NOT LIKE '%STIKER%'
      AND a.brg_kode NOT LIKE 'JASA%'
      ${branchFilterRecv}
    ORDER BY b.last_tstbj DESC
    ${paginationSql}
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
  getParetoStockHealth,
  getParetoDetails,
  getShipmentSchedules,
  saveShipmentSchedule,
  updateShipmentStatus,
  getMasterJadwalRutin,
  getCashflowSummary,
  getBranchInfo,
  getBordirSchedules,
  updateBordirSchedule,
  getLowStockSales,
  getSeasonalSales,
  getAgendaDateline,
  getDeadStockSummary,
  getDeadStockChart,
  getDeadStockSalesPie,
  getDeadStockSalesDetail,
  getSpkPendingApproval,
  getAutoMintaAnalytics,
  getRealStockList,
  getStokKosongFastMoving,
};
