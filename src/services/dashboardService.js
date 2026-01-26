const pool = require("../config/database");
const { startOfMonth, endOfMonth, format, subDays } = require("date-fns");

// Fungsi untuk mengambil statistik penjualan & transaksi hari ini
const getTodayStats = async (user) => {
  const today = format(new Date(), "yyyy-MM-dd");
  let branchFilter = "AND h.inv_cab = ?";
  let params = [today, today, user.cabang];

  const isKDC = user.cabang === "KDC";

  // LOGIK KHUSUS KDC
  if (isKDC) {
    branchFilter = "";
    // Params untuk query utama: [Regex, Today, Today]
    // Regex digunakan untuk exclude Custom Order di perhitungan QTY (bukan Omset)
    const excludePattern = "^K[0-9]{2}\\.(SD|BR|PM|DP|TG|PL|SB)\\.";
    params = [excludePattern, today, today];
  } else {
    const excludePattern = "^K[0-9]{2}\\.(SD|BR|PM|DP|TG|PL|SB)\\.";
    params = [excludePattern, today, today, user.cabang];
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
  if (isKDC) {
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
                    ${getBranchFilter("h.so_cab")} -- Menggunakan kolom so_cab
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
        WHERE h.sd_stok = "" AND h.sd_tanggal >= ? 
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

const getSalesTargetSummary = async (user) => {
  const tahun = new Date().getFullYear();
  const bulan = new Date().getMonth() + 1;

  let branchFilter = "AND h.inv_cab = ?";
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
                rh.rj_cab AS cabang,
                SUM(rd.rjd_jumlah * (rd.rjd_harga - rd.rjd_diskon)) AS total_retur
            FROM trj_hdr rh
            JOIN trj_dtl rd ON rd.rjd_nomor = rh.rj_nomor
            WHERE YEAR(rh.rj_tanggal) = ? AND MONTH(rh.rj_tanggal) = ?
            GROUP BY rh.rj_cab
        ),
        -- [BARU] Hitung Biaya Platform (Marketplace Fee)
        MonthlyFees AS (
            SELECT 
                inv_cab AS cabang,
                SUM(COALESCE(inv_mp_biaya_platform, 0)) AS total_fee
            FROM tinv_hdr
            WHERE YEAR(inv_tanggal) = ? AND MONTH(inv_tanggal) = ?
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
  // Urutan: Sales(2) -> Target(2) -> Returns(2) -> Fees(2)
  const params = [tahun, bulan, tahun, bulan, tahun, bulan, tahun, bulan];

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
 * @description Menghitung total sisa piutang.
 */
const getTotalSisaPiutang = async (user) => {
  let branchFilter = "AND u.ph_cab = ?";
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
    WHERE (v.debet - v.kredit) > 0  -- Hanya ambil yang masih ada sisa
    GROUP BY u.ph_cab, g.gdg_nama
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
        WHERE u.ph_cab = ?
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

  // 3. [BARU] Cek Retur ke DC yang belum diterima oleh DC
  // Logika: Asal (rb_cab) = Cabang User, dan rb_noterima masih kosong
  const queryReturDc = `
    SELECT COUNT(*) AS total
    FROM trbdc_hdr
    WHERE rb_cab = ?
      AND (rb_noterima IS NULL OR rb_noterima = '')
      AND rb_tanggal >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
  `;

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

  // Jalankan Query secara paralel
  const [rowsSj, rowsMutasi, rowsReturDc, rowsPinjam] = await Promise.all([
    pool.query(querySj, [cabang]),
    pool.query(queryMutasi, [cabang]),
    pool.query(queryReturDc, [cabang]),
    pool.query(queryPinjam, paramsPinjam),
  ]);

  return {
    sj_pending: rowsSj[0][0].total || 0,
    mutasi_pending: rowsMutasi[0][0].total || 0,
    retur_dc_pending: rowsReturDc[0][0].total || 0, // [BARU]
    pinjam_overdue: rowsPinjam[0][0].total || 0,
  };
};

const getStokKosongReguler = async (
  user,
  searchTerm = "",
  targetCabang = "",
) => {
  // 1. Tentukan Cabang: Jika KDC pilih ALL, kita akan tarik data global
  let branchToCheck =
    user.cabang === "KDC" && targetCabang ? targetCabang : user.cabang;
  const searchPattern = `%${searchTerm}%`;

  // Buat filter dinamis untuk cabang
  let branchFilter = "";
  const params = [];

  if (branchToCheck !== "ALL") {
    branchFilter = "AND m.mst_cab = ?";
    params.push(branchToCheck);
  }

  // Masukkan parameter pencarian
  params.push(searchPattern, searchPattern, searchPattern);

  const query = `
    SELECT 
        b.brgd_kode AS kode,
        b.brgd_barcode AS barcode,
        TRIM(CONCAT(a.brg_jeniskaos, ' ', a.brg_tipe, ' ', a.brg_lengan, ' ', a.brg_jeniskain, ' ', a.brg_warna)) AS nama_barang,
        b.brgd_ukuran AS ukuran,
        a.brg_ktgp AS kategori,
        /* Jika ALL, ini adalah total stok gabungan seluruh toko */
        IFNULL(SUM(m.mst_stok_in - m.mst_stok_out), 0) AS stok_akhir
    FROM tbarangdc_dtl b
    JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
    LEFT JOIN tmasterstok m ON m.mst_brg_kode = b.brgd_kode 
        AND m.mst_ukuran = b.brgd_ukuran 
        AND m.mst_aktif = 'Y'
        ${branchFilter}
    WHERE a.brg_aktif = 0
      AND a.brg_ktgp = 'REGULER'
      AND b.brgd_ukuran IN ('S', 'M', 'L', 'XL', '2XL') 
      AND (
          b.brgd_kode LIKE ? OR b.brgd_barcode LIKE ? OR 
          CONCAT(a.brg_jeniskaos, ' ', a.brg_tipe, ' ', a.brg_lengan, ' ', a.brg_jeniskain, ' ', a.brg_warna) LIKE ?
      )
    GROUP BY b.brgd_kode, b.brgd_barcode, b.brgd_ukuran, a.brg_ktgp, a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna
    HAVING stok_akhir <= 0
    ORDER BY nama_barang, ukuran;
  `;

  const [allRows] = await pool.query(query, params);

  // 2. Berikan hasil dengan total asli dan data terbatas untuk performa UI
  return {
    data: allRows.slice(0, 250), // Hanya kirim 250 untuk list agar enteng
    totalCount: allRows.length, // Kirim angka asli (misal 800) untuk label chip
  };
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

    const params = [];
    params.push(startDateStr); // Param 1: Tanggal

    let stokFilter = "";
    let salesFilter = "";

    if (gudang && gudang !== "ALL") {
      // 1. Filter STOK: Selalu spesifik ke gudang yang diminta
      stokFilter = "AND m.mst_cab = ?";

      // 2. Filter SALES (Pareto):
      if (isPusat) {
        // Jika KDC: Pareto ditentukan dari Global Sales (Semua Cabang)
        salesFilter = "";
      } else {
        // Jika Cabang: Pareto ditentukan dari Sales Cabang itu sendiri
        salesFilter = "AND h.inv_cab = ?";
      }
    }

    if (gudang && gudang !== "ALL") {
      if (!isPusat) {
        params.push(gudang); // Param Sales (Jika Cabang)
      }
      params.push(gudang); // Param Stok
    }

    const query = `
      SELECT 
        -- 1. STOK AKTUAL (Numerator)
        SUM(IFNULL(s.stok, 0)) AS total_actual_stock,
        
        -- 2. BUFFER STANDAR (Denominator Base)
        -- Ini adalah total brgd_min dari barang-barang pareto (untuk 1 toko)
        SUM(IFNULL(b.brgd_min, 0)) AS base_buffer_pareto,
        
        -- 3. JUMLAH ITEM
        COUNT(DISTINCT a.brg_kode) AS count_pareto_sku,

        -- 4. [BARU] HITUNG JUMLAH TOKO AKTIF (Dinamis)
        -- Hitung berapa banyak gudang yang BUKAN DC (gdg_dc = 0)
        (SELECT COUNT(gdg_kode) FROM tgudang WHERE gdg_dc = 0) AS active_store_count

      FROM tbarangdc a
      JOIN tbarangdc_dtl b ON a.brg_kode = b.brgd_kode
      
      -- Filter Pareto / Demand
      INNER JOIN (
          SELECT DISTINCT d.invd_kode, d.invd_ukuran
          FROM tinv_dtl d
          JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
          WHERE h.inv_sts_pro = 0 
            AND h.inv_tanggal >= ? 
            ${salesFilter} 
      ) pareto ON a.brg_kode = pareto.invd_kode AND b.brgd_ukuran = pareto.invd_ukuran

      -- Filter Stok (Supply)
      LEFT JOIN (
          SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in - mst_stok_out) as stok
          FROM tmasterstok m WHERE m.mst_aktif = 'Y' ${stokFilter}
          GROUP BY mst_brg_kode, mst_ukuran
      ) s ON a.brg_kode = s.mst_brg_kode AND b.brgd_ukuran = s.mst_ukuran

      WHERE a.brg_aktif = 0 
        AND a.brg_logstok = 'Y';
    `;

    const [rows] = await connection.query(query, params);
    const result = rows[0];

    const actual = Number(result.total_actual_stock) || 0;
    const baseBuffer = Number(result.base_buffer_pareto) || 0;
    const count = Number(result.count_pareto_sku) || 0;
    const storeCount = Number(result.active_store_count) || 1; // Default 1 biar aman

    // --- PERHITUNGAN TARGET DINAMIS ---
    let finalTargetBuffer = baseBuffer;

    if (isPusat) {
      // [LOGIKA KDC]
      // Target KDC = (Buffer Barang Pareto) x (Jumlah Toko Aktif di Database)
      // Ini mengakomodir penambahan toko secara otomatis
      finalTargetBuffer = baseBuffer * storeCount;
    }

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
      store_count: storeCount, // Kirim info jumlah toko agar bisa dicek di frontend
    });
  } catch (error) {
    console.error("Error getParetoStockHealth:", error);
    throw error;
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
    const params = [startDateStr];

    let stokFilter = "";
    let salesFilter = "";

    // Setup Filter dasar
    if (gudang && gudang !== "ALL") {
      stokFilter = "AND m.mst_cab = ?";
      salesFilter = isPusat ? "" : "AND h.inv_cab = ?";
    }

    if (gudang && gudang !== "ALL") {
      if (!isPusat) params.push(gudang);
      params.push(gudang);
    }

    // 1. QUERY UTAMA: List Barang Pareto
    const queryItems = `
      SELECT 
        a.brg_kode AS kode,
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
        b.brgd_ukuran AS ukuran,
        IFNULL(s.stok, 0) AS stok_aktual,
        IFNULL(b.brgd_min, 0) AS buffer_base,
        pareto.qty_sold AS penjualan_bulan_ini,
        (SELECT COUNT(gdg_kode) FROM tgudang WHERE gdg_dc = 0) AS store_count
      FROM tbarangdc a
      JOIN tbarangdc_dtl b ON a.brg_kode = b.brgd_kode
      INNER JOIN (
          SELECT d.invd_kode, d.invd_ukuran, SUM(d.invd_jumlah) as qty_sold
          FROM tinv_dtl d
          JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
          WHERE h.inv_sts_pro = 0 AND h.inv_tanggal >= ? ${salesFilter}
          GROUP BY d.invd_kode, d.invd_ukuran
      ) pareto ON a.brg_kode = pareto.invd_kode AND b.brgd_ukuran = pareto.invd_ukuran
      LEFT JOIN (
          SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in - mst_stok_out) as stok
          FROM tmasterstok m WHERE m.mst_aktif = 'Y' ${stokFilter}
          GROUP BY mst_brg_kode, mst_ukuran
      ) s ON a.brg_kode = s.mst_brg_kode AND b.brgd_ukuran = s.mst_ukuran
      WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
      ORDER BY pareto.qty_sold DESC;
    `;

    const [items] = await connection.query(queryItems, params);

    // 2. QUERY TAMBAHAN: Detail Stok & Penjualan Per Cabang
    // Ambil data hanya untuk barang-barang yang masuk list pareto di atas agar efisien
    let branchDetails = [];

    if (items.length > 0 && isPusat) {
      // Kumpulkan kode barang untuk filter WHERE IN
      const codes = items.map((i) => `'${i.kode}'`).join(","); // Hati-hati SQL Injection jika kode aneh, tapi aman jika internal

      // Query ini mengambil breakdown per cabang untuk item-item tersebut
      const queryBreakdown = `
          SELECT 
            m.mst_cab AS cabang_kode,
            g.gdg_nama AS cabang_nama,
            m.mst_brg_kode AS kode,
            m.mst_ukuran AS ukuran,
            SUM(m.mst_stok_in - m.mst_stok_out) AS stok
          FROM tmasterstok m
          LEFT JOIN tgudang g ON m.mst_cab = g.gdg_kode
          WHERE m.mst_aktif = 'Y' 
            AND m.mst_brg_kode IN (SELECT brg_kode FROM tbarangdc WHERE brg_logstok='Y') -- Optimasi sederhana
            AND g.gdg_dc = 0 -- Hanya ambil toko, bukan DC lain
          GROUP BY m.mst_cab, m.mst_brg_kode, m.mst_ukuran
       `;
      // Note: Query di atas disederhanakan. Untuk performa tinggi di data besar, sebaiknya filter by codes.
      // Tapi jika barang pareto banyak, query string jadi terlalu panjang.
      // Kita tarik global stok toko aktif saja, lalu filter di JS (lebih aman resource DB).

      const [details] = await connection.query(queryBreakdown);
      branchDetails = details;
    }

    // 3. Gabungkan Data (Merge)
    const result = items.map((row, index) => {
      const target = isPusat
        ? row.buffer_base * row.store_count
        : row.buffer_base;

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

      // Filter detail cabang milik item ini
      const itemBranches = isPusat
        ? branchDetails
            .filter((d) => d.kode === row.kode && d.ukuran === row.ukuran)
            .map((b) => ({
              nama: b.cabang_nama,
              stok: Number(b.stok),
              // Status per toko (Target per toko = buffer_base)
              status:
                Number(b.stok) < row.buffer_base
                  ? "KRITIS"
                  : Number(b.stok) > row.buffer_base * 3
                    ? "OVER"
                    : "AMAN",
            }))
        : [];

      // Urutkan detail: Cabang Kritis (Stok < Min) paling atas
      itemBranches.sort((a, b) => (a.status === "KRITIS" ? -1 : 1));

      return {
        rank: index + 1,
        kode: row.kode,
        nama: row.nama,
        ukuran: row.ukuran,
        stok: Number(row.stok_aktual),
        target: target,
        buffer_per_toko: row.buffer_base, // Info tambahan untuk frontend
        sales: Number(row.penjualan_bulan_ini),
        status,
        color,
        branches: itemBranches, // Data Nested
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
};
