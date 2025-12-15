const pool = require("../config/database");
const { format } = require("date-fns");

// Helper function untuk mengambil sales data
const getSalesData = async (filters) => {
  const { tahun, bulan, cabang } = filters;
  let query = `
        SELECT 
            tanggal, cabang, SUM(nominal) as nominal
        FROM v_sales_harian
        WHERE YEAR(tanggal) = ?
    `;
  const params = [tahun];
  if (bulan) {
    query += " AND MONTH(tanggal) = ?";
    params.push(bulan);
  }
  if (cabang && cabang !== "ALL") {
    query += " AND cabang = ?";
    params.push(cabang);
  }
  query += " GROUP BY 1, 2";
  const [rows] = await pool.query(query, params);
  return rows;
};

const getTargetData = async (filters) => {
  const { tahun, bulan, cabang } = filters;
  let query = `
        SELECT 
            kode_gudang, nama_gudang, tahun, bulan, minggu, start_date, end_date, 
            SUM(target_omset) as target,
            (1 + DATEDIFF(end_date, start_date)) as jhari
        FROM kpi.ttarget_kaosan
        WHERE tahun = ?
    `;
  const params = [tahun];
  if (bulan) {
    query += " AND bulan = ?";
    params.push(bulan);
  }
  if (cabang && cabang !== "ALL") {
    query += " AND kode_gudang = ?";
    params.push(cabang);
  }
  query += " GROUP BY 1,2,3,4,5,6,7"; // Group by semua kolom non-agregat
  const [rows] = await pool.query(query, params);
  return rows;
};

// Helper function untuk mengambil target data
const getDailyData = async (filters) => {
  const { tahun, bulan, cabang } = filters;

  // DEBUG: Cek DateRange dulu
  const debugDateRange = `
    SELECT tg2 AS tanggal, COUNT(*) as jumlah
    FROM kpi.tanggal 
    WHERE th = ? AND bl = ? AND tg2 <= CURDATE()
    GROUP BY tg2
    HAVING COUNT(*) > 1
  `;

  const [duplicates] = await pool.query(debugDateRange, [tahun, bulan]);

  if (duplicates.length > 0) {
    console.log("❌ DUPLIKASI DITEMUKAN DI kpi.tanggal:");
    console.table(duplicates);
  }

  // Query utama dengan DISTINCT di DateRange
  const query = `
        WITH DateRange AS (
    SELECT DISTINCT tg2 AS tanggal
    FROM kpi.tanggal 
    WHERE th = ? AND bl = ? AND tg2 <= CURDATE()
),
DailySales AS (
    SELECT tanggal, SUM(nominal) AS omset 
    FROM v_sales_harian 
    WHERE YEAR(tanggal) = ? AND MONTH(tanggal) = ?
    ${cabang !== "ALL" ? "AND cabang = ?" : ""}
    GROUP BY tanggal
),
TargetAggregated AS (
    SELECT 
        tahun, bulan, start_date, end_date,
        ${cabang !== "ALL" ? "kode_gudang," : ""}
        SUM(target_omset) AS target_total,
        1 + DATEDIFF(end_date, start_date) AS jhari,
        SUM(target_omset) / (1 + DATEDIFF(end_date, start_date)) AS target_harian
    FROM kpi.ttarget_kaosan
    WHERE tahun = ? AND bulan = ?
    ${cabang !== "ALL" ? "AND kode_gudang = ?" : ""}
    GROUP BY tahun, bulan, start_date, end_date
),
MonthlyTarget AS (
    SELECT SUM(target_total) AS bulan_total FROM TargetAggregated
),
DailyTargets AS (
    SELECT t.tanggal, SUM(ta.target_harian) AS target
    FROM DateRange t
    INNER JOIN TargetAggregated ta 
        ON YEAR(t.tanggal) = ta.tahun 
        AND MONTH(t.tanggal) = ta.bulan 
        AND t.tanggal BETWEEN ta.start_date AND ta.end_date
    GROUP BY t.tanggal
)
SELECT 
    ? AS kode_cabang,
    ${
      cabang === "ALL"
        ? "'ALL TOKO' AS nama_cabang"
        : "(SELECT gdg_nama FROM tgudang WHERE gdg_kode = ? LIMIT 1) AS nama_cabang"
    },
    LEFT(DAYNAME(dr.tanggal), 3) AS hari,
    dr.tanggal,
    IFNULL(ds.omset, 0) AS omset,
    IFNULL(dt.target, 0) AS target,
    (SELECT bulan_total FROM MonthlyTarget LIMIT 1) AS target_bulanan,
    (
      SELECT IFNULL(SUM(rd.rjd_jumlah * (rd.rjd_harga - rd.rjd_diskon)), 0)
      FROM trj_hdr rh
      JOIN trj_dtl rd ON rd.rjd_nomor = rh.rj_nomor
      WHERE DATE(rh.rj_tanggal) = dr.tanggal
      ${cabang !== "ALL" ? "AND LEFT(rh.rj_nomor, 3) = ?" : ""}
    ) AS retur_jual
FROM DateRange dr
LEFT JOIN DailySales ds ON dr.tanggal = ds.tanggal
LEFT JOIN DailyTargets dt ON dr.tanggal = dt.tanggal
ORDER BY dr.tanggal;
    `;

  const params = [
    tahun,
    bulan,
    tahun,
    bulan,
    ...(cabang !== "ALL" ? [cabang] : []),
    tahun,
    bulan,
    ...(cabang !== "ALL" ? [cabang] : []),
    cabang,
    ...(cabang !== "ALL" ? [cabang] : []),
    ...(cabang !== "ALL" ? [cabang] : []),
  ];

  console.log("=== DEBUG: getDailyData ===");
  console.log("Params:", params);

  const [rows] = await pool.query(query, params);

  console.log("Rows returned from MySQL:", rows.length);

  // Cek duplikasi di hasil akhir
  const groupedByDate = rows.reduce((acc, row) => {
    const dateKey = row.tanggal.toISOString();
    acc[dateKey] = (acc[dateKey] || 0) + 1;
    return acc;
  }, {});

  const duplicateDates = Object.entries(groupedByDate)
    .filter(([_, count]) => count > 1)
    .map(([date, count]) => ({ date, count }));

  if (duplicateDates.length > 0) {
    console.log("❌ DUPLIKASI DI HASIL AKHIR:");
    console.table(duplicateDates);
  }

  let cumulativeSales = 0;
  let cumulativeTarget = 0;

  // Deduplikasi manual di JavaScript sebagai safety net
  const uniqueRows = [];
  const seenDates = new Set();

  for (const row of rows) {
    const dateKey = row.tanggal.toISOString();
    if (!seenDates.has(dateKey)) {
      seenDates.add(dateKey);
      const nettoHariIni = row.omset - (row.retur_jual || 0);
      cumulativeSales += nettoHariIni;
      cumulativeTarget += row.target;
      const targetBulanan = row.target_bulanan || 0;
      uniqueRows.push({
        ...row,
        nama_cabang: cabang === "ALL" ? "ALL TOKO" : row.nama_cabang,
        total_omset: cumulativeSales,
        target_bulanan: targetBulanan,
        ach: targetBulanan > 0 ? (cumulativeSales / targetBulanan) * 100 : 0,
      });
    }
  }

  console.log("Unique rows after deduplication:", uniqueRows.length);

  return uniqueRows;
};

const getWeeklyData = async (filters) => {
  const { tahun, bulan, cabang } = filters;

  const query = `
        WITH WeeklySummary AS (
            SELECT 
                t.tahun, 
                t.bulan, 
                t.minggu, 
                t.kode_gudang AS kode_cabang,
                g.gdg_nama AS nama_cabang,
                IFNULL(s.nominal, 0) AS nominal,
                IFNULL(t.target, 0) AS target
            FROM (
                SELECT tahun, bulan, minggu, kode_gudang, SUM(target_omset) AS target, start_date, end_date
                FROM kpi.ttarget_kaosan
                WHERE tahun = ? AND bulan = ?
                ${cabang !== "ALL" ? "AND kode_gudang = ?" : ""}
                GROUP BY 1,2,3,4,6,7
            ) t
            JOIN tgudang g ON t.kode_gudang = g.gdg_kode
            LEFT JOIN (
                SELECT tanggal, cabang, SUM(nominal) AS nominal
                FROM v_sales_harian
                WHERE YEAR(tanggal) = ? AND MONTH(tanggal) = ?
                ${
                  cabang !== "ALL" ? "AND cabang = ?" : ""
                } -- <-- PERBAIKAN: Tambah filter cabang
                GROUP BY 1,2
            ) s ON s.cabang = t.kode_gudang AND s.tanggal BETWEEN t.start_date AND t.end_date
        )
        SELECT
            kode_cabang,
            nama_cabang,
            SUM(CASE WHEN minggu = 1 THEN nominal ELSE 0 END) AS nominal_w1,
            SUM(CASE WHEN minggu = 1 THEN target ELSE 0 END) AS target_w1,
            SUM(CASE WHEN minggu = 2 THEN nominal ELSE 0 END) AS nominal_w2,
            SUM(CASE WHEN minggu = 2 THEN target ELSE 0 END) AS target_w2,
            SUM(CASE WHEN minggu = 3 THEN nominal ELSE 0 END) AS nominal_w3,
            SUM(CASE WHEN minggu = 3 THEN target ELSE 0 END) AS target_w3,
            SUM(CASE WHEN minggu = 4 THEN nominal ELSE 0 END) AS nominal_w4,
            SUM(CASE WHEN minggu = 4 THEN target ELSE 0 END) AS target_w4,
            SUM(CASE WHEN minggu = 5 THEN nominal ELSE 0 END) AS nominal_w5,
            SUM(CASE WHEN minggu = 5 THEN target ELSE 0 END) AS target_w5,
            SUM(nominal) as total_nominal,
            SUM(target) as total_target
        FROM WeeklySummary
        GROUP BY kode_cabang, nama_cabang
        HAVING total_nominal > 0 OR total_target > 0
        ORDER BY kode_cabang;
    `; // --- PERBAIKAN: Urutan params harus benar ---

  const params = [tahun, bulan];
  if (cabang !== "ALL") {
    params.push(cabang); // Untuk kpi.ttarget_kaosan
  }
  params.push(tahun, bulan);
  if (cabang !== "ALL") {
    params.push(cabang); // Untuk v_sales_harian
  } // --------------------------------------------
  const [rows] = await pool.query(query, params);
  return rows;
};

const getMonthlyData = async (filters) => {
  const { tahun, bulan, cabang } = filters;

  const query = `
        WITH MonthlySales AS (
            SELECT 
                cabang, 
                SUM(nominal) AS nominal 
            FROM v_sales_harian
            WHERE YEAR(tanggal) = ? AND MONTH(tanggal) = ?
            ${
              cabang !== "ALL" ? "AND cabang = ?" : ""
            } -- <-- PERBAIKAN: Tambah filter cabang
            GROUP BY cabang
        ),
        MonthlyTargets AS (
            SELECT 
                kode_gudang AS cabang, 
                SUM(target_omset) AS target
            FROM kpi.ttarget_kaosan
            WHERE tahun = ? AND bulan = ?
            ${
              cabang !== "ALL" ? "AND kode_gudang = ?" : ""
            } -- <-- PERBAIKAN: Tambah filter cabang
            GROUP BY cabang
        ),
        RelevantBranches AS (
            SELECT cabang FROM MonthlySales
            UNION
            SELECT cabang FROM MonthlyTargets
        )
        SELECT
            ? AS tahun,
            ? AS bulan,
            rb.cabang AS kode_cabang,
            g.gdg_nama AS nama_cabang,
            IFNULL(ms.nominal, 0) AS nominal,
            IFNULL(mt.target, 0) AS target
        FROM RelevantBranches rb
        JOIN tgudang g ON rb.cabang = g.gdg_kode
        LEFT JOIN MonthlySales ms ON rb.cabang = ms.cabang
        LEFT JOIN MonthlyTargets mt ON rb.cabang = mt.cabang
        ${cabang !== "ALL" ? "WHERE rb.cabang = ?" : ""}
        ORDER BY rb.cabang;
    `; // --- PERBAIKAN: Urutan params harus benar ---

  const params = [
    tahun,
    bulan, // Untuk MonthlySales
  ];
  if (cabang !== "ALL") {
    params.push(cabang); // Untuk MonthlySales
  }
  params.push(tahun, bulan); // Untuk MonthlyTargets
  if (cabang !== "ALL") {
    params.push(cabang); // Untuk MonthlyTargets
  }
  params.push(tahun, bulan); // Untuk SELECT utama
  if (cabang !== "ALL") {
    params.push(cabang); // Untuk WHERE rb.cabang
  } // --------------------------------------------
  const [rows] = await pool.query(query, params);

  return rows.map((row) => ({
    ...row,
    ach: row.target > 0 ? (row.nominal / row.target) * 100 : 0,
  }));
};

const getYtdData = async (filters) => {
  const { tahun, cabang } = filters;

  // Query ini dirombak untuk mengelompokkan dengan benar
  const query = `
        SELECT
            y.tahun,
            y.bulan,
            y.kode_cabang,
            y.nama_cabang,
            SUM(y.nominal) AS nominal,
            SUM(y.target) AS target,
            IF(SUM(y.target) > 0, (SUM(y.nominal) / SUM(y.target)) * 100, 0) AS ach
        FROM (
            SELECT 
                t.tahun, t.bulan, t.kode_gudang AS kode_cabang, g.gdg_nama AS nama_cabang,
                IFNULL(s.nominal, 0) AS nominal,
                IFNULL(t.target, 0) AS target
            FROM (
                SELECT tahun, bulan, kode_gudang, SUM(target_omset) AS target
                FROM kpi.ttarget_kaosan
                WHERE tahun = ?
                GROUP BY 1, 2, 3
            ) t
            LEFT JOIN (
                SELECT YEAR(tanggal) AS tahun, MONTH(tanggal) AS bulan, cabang, SUM(nominal) AS nominal
                FROM v_sales_harian
                WHERE YEAR(tanggal) = ?
                GROUP BY 1, 2, 3
            ) s ON t.tahun = s.tahun AND t.bulan = s.bulan AND t.kode_gudang = s.cabang
            JOIN tgudang g ON t.kode_gudang = g.gdg_kode
        ) y
        ${cabang !== "ALL" ? "WHERE y.kode_cabang = ?" : ""}
        GROUP BY y.tahun, y.bulan, y.kode_cabang, y.nama_cabang
        ORDER BY y.bulan, y.kode_cabang;
    `;

  const params = [tahun, tahun];
  if (cabang !== "ALL") {
    params.push(cabang);
  }

  const [rows] = await pool.query(query, params);

  // Jika filter 'ALL', kita perlu agregasi tambahan di sini
  if (cabang === "ALL") {
    const aggregated = {};
    rows.forEach((row) => {
      if (!aggregated[row.bulan]) {
        aggregated[row.bulan] = {
          tahun: row.tahun,
          bulan: row.bulan,
          kode_cabang: "ALL",
          nama_cabang: "SEMUA TOKO",
          nominal: 0,
          target: 0,
        };
      }
      aggregated[row.bulan].nominal += row.nominal;
      aggregated[row.bulan].target += row.target;
    });
    return Object.values(aggregated).map((d) => ({
      ...d,
      ach: d.target > 0 ? (d.nominal / d.target) * 100 : 0,
    }));
  }

  return rows;
};

const getCabangOptions = async (user) => {
  let query;
  const params = [];

  // If the user is from the central warehouse (KDC), they can see all options
  if (user.cabang === "KDC") {
    query = `
            SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang
            UNION ALL 
            SELECT 'ALL' AS kode, 'ALL STORE' AS nama
            ORDER BY kode;
        `;
  } else {
    // If it's a regular branch user, they can only see their own branch
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?";
    params.push(user.cabang);
  }

  const [rows] = await pool.query(query, params);
  return rows;
};

// Fungsi untuk menyimpan target
const saveTarget = async (payload, user) => {
  const { tahun, bulan, kode_gudang, targets } = payload;

  // Validasi User
  if (user.cabang !== "KDC" || user.kode !== "HARIS") {
    throw new Error("Akses ditolak. Hanya PAK HARIS yang boleh input target.");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Ambil Nama Gudang
    const [gudangRows] = await connection.query(
      "SELECT gdg_nama FROM tgudang WHERE gdg_kode = ?",
      [kode_gudang]
    );
    const nama_gudang = gudangRows.length > 0 ? gudangRows[0].gdg_nama : "";

    // 2. Hapus target lama
    await connection.query(
      `DELETE FROM kpi.ttarget_kaosan 
       WHERE tahun = ? AND bulan = ? AND kode_gudang = ?`,
      [tahun, bulan, kode_gudang]
    );

    // 3. Insert Target Baru (LOGIKA 4 MINGGU)
    const lastDayOfMonth = new Date(tahun, bulan, 0).getDate(); // misal 30, 31, atau 28

    for (const item of targets) {
      const nominal = parseFloat(item.nominal) || 0;
      if (nominal === 0) continue;

      let startDay, endDay;

      // --- LOGIKA PEMBAGIAN TANGGAL 4 MINGGU ---
      if (item.minggu === 1) {
        startDay = 1;
        endDay = 7;
      } else if (item.minggu === 2) {
        startDay = 8;
        endDay = 14;
      } else if (item.minggu === 3) {
        startDay = 15;
        endDay = 21;
      } else if (item.minggu === 4) {
        startDay = 22;
        endDay = lastDayOfMonth; // Sisa hari masuk ke Minggu 4
      } else {
        continue; // Abaikan jika ada data minggu ke-5 dst
      }

      const startDate = `${tahun}-${String(bulan).padStart(2, "0")}-${String(
        startDay
      ).padStart(2, "0")}`;
      const endDate = `${tahun}-${String(bulan).padStart(2, "0")}-${String(
        endDay
      ).padStart(2, "0")}`;

      await connection.query(
        `INSERT INTO kpi.ttarget_kaosan 
            (tahun, bulan, minggu, kode_gudang, nama_gudang, target_omset, start_date, end_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tahun,
          bulan,
          item.minggu,
          kode_gudang,
          nama_gudang,
          nominal,
          startDate,
          endDate,
        ]
      );
    }

    await connection.commit();
    return { message: "Target berhasil disimpan." };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  getDailyData,
  getWeeklyData,
  getMonthlyData,
  getYtdData,
  getCabangOptions,
  saveTarget,
};
