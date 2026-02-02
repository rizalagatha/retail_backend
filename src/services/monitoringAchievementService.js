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
    ),
    -- [BARU] CTE CleanPiutang: Hitung saldo per invoice, jika minus dianggap 0
    CleanPiutang AS (
        SELECT 
            h.inv_tanggal,
            h.inv_cab,
            -- Logika: Max(0, Debet - Kredit)
            GREATEST(SUM(pd.pd_debet - pd.pd_kredit), 0) AS sisa
        FROM tinv_hdr h
        JOIN tpiutang_hdr ph ON ph.ph_inv_nomor = h.inv_nomor
        JOIN tpiutang_dtl pd ON pd.pd_ph_nomor = ph.ph_nomor
        ${cabang !== "ALL" ? "WHERE h.inv_cab = ?" : ""}
        GROUP BY h.inv_nomor
        HAVING sisa > 0 -- Optimasi: Hanya ambil yang benar-benar ada piutang
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
        
        -- Retur Jual (Achievement Mode: Menghitung Kerugian Omset Riil)
        (
          SELECT IFNULL(SUM(
            CASE 
              -- 1. TUKAR BARANG (N): Kerugian = Nilai Barang Retur - Nilai yang Dipakai Belanja Lagi
              WHEN rh.rj_jenis = 'N' THEN (
                SELECT GREATEST(0, 
                    IFNULL(SUM(rd.rjd_jumlah * (rd.rjd_harga - rd.rjd_diskon)), 0) - 
                    IFNULL((SELECT SUM(inv_rj_rp) FROM tinv_hdr WHERE inv_rj_nomor = rh.rj_nomor), 0)
                )
                FROM trj_dtl rd WHERE rd.rjd_nomor = rh.rj_nomor
              )
              -- 2. PENGEMBALIAN (Y): Kerugian = Nominal Cash Out yang tercatat di Refund
              WHEN rh.rj_jenis = 'Y' THEN (
                SELECT IFNULL(SUM(rfd_refund), 0) 
                FROM trefund_dtl 
                WHERE rfd_notrs = rh.rj_inv -- Menghubungkan Invoice Asal ke data Refund
              )
              ELSE 0
            END
          ), 0)
          FROM trj_hdr rh
          WHERE DATE(rh.rj_tanggal) = dr.tanggal
          ${cabang !== "ALL" ? "AND rh.rj_cab = ?" : ""}
        ) AS retur_jual,

        -- 1. Open SO (Per Hari Ini) yang benar-benar belum ter-Invoice
(
    SELECT IFNULL(SUM(d.sod_jumlah * d.sod_harga), 0)
    FROM tso_hdr h
    JOIN tso_dtl d ON d.sod_so_nomor = h.so_nomor
    WHERE DATE(h.so_tanggal) = dr.tanggal
      AND h.so_aktif = 'Y' AND h.so_close = 0
      -- Filter pengunci: Pastikan SO belum terdaftar di Invoice
      AND h.so_nomor NOT IN (
          SELECT DISTINCT inv_nomor_so 
          FROM tinv_hdr 
          WHERE inv_nomor_so IS NOT NULL AND inv_nomor_so <> ''
      )
      ${cabang !== "ALL" ? "AND h.so_cab = ?" : ""}
) AS so_open_today,

-- 2. Open SO (30 Hari Terakhir) yang benar-benar belum ter-Invoice
(
    SELECT IFNULL(SUM(d.sod_jumlah * d.sod_harga), 0)
    FROM tso_hdr h
    JOIN tso_dtl d ON d.sod_so_nomor = h.so_nomor
    WHERE h.so_tanggal BETWEEN DATE_SUB(dr.tanggal, INTERVAL 29 DAY) AND dr.tanggal
      AND h.so_aktif = 'Y' AND h.so_close = 0
      -- Filter pengunci: Pastikan SO belum terdaftar di Invoice
      AND h.so_nomor NOT IN (
          SELECT DISTINCT inv_nomor_so 
          FROM tinv_hdr 
          WHERE inv_nomor_so IS NOT NULL AND inv_nomor_so <> ''
      )
      ${cabang !== "ALL" ? "AND h.so_cab = ?" : ""}
) AS so_open_30days,

        -- 3. Open SO (Akumulasi) yang benar-benar belum ter-Invoice
(
    SELECT IFNULL(SUM(d.sod_jumlah * d.sod_harga), 0)
    FROM tso_hdr h
    JOIN tso_dtl d ON d.sod_so_nomor = h.so_nomor
    WHERE h.so_tanggal <= dr.tanggal
      AND h.so_aktif = 'Y' 
      AND h.so_close = 0
      -- Tambahan filter: Pastikan SO belum ada di tabel invoice
      AND h.so_nomor NOT IN (
          SELECT DISTINCT inv_nomor_so 
          FROM tinv_hdr 
          WHERE inv_nomor_so IS NOT NULL AND inv_nomor_so <> ''
      )
      ${cabang !== "ALL" ? "AND h.so_cab = ?" : ""}
) AS so_open_accum,

        -- [UPDATE] 4. Sisa Piutang (Hari Ini) - Mengambil dari CTE CleanPiutang
        (
            SELECT IFNULL(SUM(cp.sisa), 0)
            FROM CleanPiutang cp
            WHERE DATE(cp.inv_tanggal) = dr.tanggal
        ) AS piutang_today,

        -- [UPDATE] 5. Sisa Piutang (30 Hari)
        (
            SELECT IFNULL(SUM(cp.sisa), 0)
            FROM CleanPiutang cp
            WHERE cp.inv_tanggal BETWEEN DATE_SUB(dr.tanggal, INTERVAL 29 DAY) AND dr.tanggal
        ) AS piutang_30days,

        -- [UPDATE] 6. Sisa Piutang (Akumulasi)
        (
            SELECT IFNULL(SUM(cp.sisa), 0)
            FROM CleanPiutang cp
            WHERE cp.inv_tanggal <= dr.tanggal
        ) AS piutang_accum

    FROM DateRange dr
    LEFT JOIN DailySales ds ON dr.tanggal = ds.tanggal
    LEFT JOIN DailyTargets dt ON dr.tanggal = dt.tanggal
    ORDER BY dr.tanggal;
  `;

  // Susunan Parameter
  const params = [
    tahun,
    bulan, // DateRange
    tahun,
    bulan, // DailySales
    ...(cabang !== "ALL" ? [cabang] : []),
    tahun,
    bulan, // TargetAggregated
    ...(cabang !== "ALL" ? [cabang] : []),
    ...(cabang !== "ALL" ? [cabang] : []), // CleanPiutang

    cabang, // SELECT kode_cabang
    ...(cabang !== "ALL" ? [cabang] : []), // SELECT nama_cabang
    ...(cabang !== "ALL" ? [cabang] : []), // Retur Jual

    // Open SO Params (3x)
    ...(cabang !== "ALL" ? [cabang] : []), // Today
    ...(cabang !== "ALL" ? [cabang] : []), // 30 Days
    ...(cabang !== "ALL" ? [cabang] : []), // Accum

    // Piutang Params: TIDAK PERLU PARAM TAMBAHAN
    // Karena CTE CleanPiutang sudah difilter cabang di awal,
    // dan join tanggal menggunakan dr.tanggal
  ];

  const [rows] = await pool.query(query, params);

  const uniqueRows = [];
  const seenDates = new Set();
  let cumulativeSales = 0;

  for (const row of rows) {
    const dateKey = row.tanggal.toISOString();
    if (!seenDates.has(dateKey)) {
      seenDates.add(dateKey);
      const nettoHariIni = row.omset - (row.retur_jual || 0);
      cumulativeSales += nettoHariIni;

      uniqueRows.push({
        ...row,
        nama_cabang: cabang === "ALL" ? "ALL TOKO" : row.nama_cabang,
        total_omset: cumulativeSales,
        ach:
          row.target_bulanan > 0
            ? (cumulativeSales / row.target_bulanan) * 100
            : 0,

        // Casting ke Number untuk keamanan
        so_open_today: Number(row.so_open_today),
        so_open_30days: Number(row.so_open_30days),
        so_open_accum: Number(row.so_open_accum),
        piutang_today: Number(row.piutang_today),
        piutang_30days: Number(row.piutang_30days),
        piutang_accum: Number(row.piutang_accum),
      });
    }
  }

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
      [kode_gudang],
    );
    const nama_gudang = gudangRows.length > 0 ? gudangRows[0].gdg_nama : "";

    // 2. Hapus target lama
    await connection.query(
      `DELETE FROM kpi.ttarget_kaosan 
       WHERE tahun = ? AND bulan = ? AND kode_gudang = ?`,
      [tahun, bulan, kode_gudang],
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
        startDay,
      ).padStart(2, "0")}`;
      const endDate = `${tahun}-${String(bulan).padStart(2, "0")}-${String(
        endDay,
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
        ],
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
