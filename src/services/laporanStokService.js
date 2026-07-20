const pool = require("../config/database");
const { format, subMonths } = require("date-fns");

const getRealTimeStock = async (filters) => {
  const { gudang, kodeBarang, keyword, jenisStok, tampilkanKosong, tanggal } =
    filters;
  const connection = await pool.getConnection();
  try {
    // 1. Tentukan Sumber Tabel
    let stockSourceTable = "";
    if (jenisStok === "showroom") {
      stockSourceTable = "tmasterstok";
    } else if (jenisStok === "pesanan") {
      stockSourceTable = "tmasterstokso";
    } else {
      stockSourceTable = `(
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif 
        FROM tmasterstok
        UNION ALL
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif 
        FROM tmasterstokso
      )`;
    }

    // 2. Siapkan Filter Dasar untuk subquery Size
    let baseParams = [tanggal];
    let gudangFilter = "1 = 1";
    if (gudang !== "ALL") {
      gudangFilter = `m.mst_cab = ?`;
      baseParams.push(gudang);
    }

    let kodeBarangFilter = "";
    let kodeParams = [];
    if (kodeBarang && kodeBarang.trim() !== "") {
      kodeBarangFilter = " AND a.brg_kode = ? ";
      kodeParams.push(kodeBarang);
    }

    let searchFilter = "";
    let searchParams = [];
    if (keyword && keyword.trim() !== "") {
      const searchTerm = `%${keyword.trim()}%`;
      searchFilter = ` AND (a.brg_kode LIKE ? OR TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna)) LIKE ?)`;
      searchParams.push(searchTerm, searchTerm);
    }

    // 3. Ambil Daftar Ukuran
    const sizeQuery = `
      SELECT DISTINCT m.mst_ukuran
      FROM ${stockSourceTable} m
      LEFT JOIN tbarangdc a ON a.brg_kode = m.mst_brg_kode
      WHERE m.mst_aktif = 'Y' 
        AND m.mst_tanggal <= ? 
        AND ${gudangFilter}
        ${kodeBarangFilter}
        ${searchFilter}
      ORDER BY m.mst_ukuran
    `;
    const sizeParams = [...baseParams, ...kodeParams, ...searchParams];
    const [sizes] = await connection.query(sizeQuery, sizeParams);

    let dynamicColumns = "";
    if (sizes.length > 0) {
      dynamicColumns = sizes
        .map((row) => {
          const sizeLabel = row.mst_ukuran.replace(/'/g, "''");
          return `SUM(CASE WHEN s.mst_ukuran = '${sizeLabel}' THEN s.stok ELSE 0 END) AS '${sizeLabel}'`;
        })
        .join(", \n");
      dynamicColumns = ", " + dynamicColumns;
    }

    // [BARU] Mode "store spesifik" — cuma aktif kalau gudang bukan ALL/KDC.
    // Pesanan Ready/Booked cuma bermakna untuk 1 cabang toko tertentu, bukan
    // agregat lintas cabang (ALL) atau konteks DC (KDC).
    const isStoreMode = gudang !== "ALL" && gudang !== "KDC";

    let pesananCTESql = "";
    let pesananSelectSql = "";
    let pesananJoinSql = "";
    const pesananParamsPre = [];
    const pesananParamsSelect = [];

    if (isStoreMode) {
      // Reuse persis logic penentuan "SO masih OPEN" dari dashboardService.getRealStockList
      pesananCTESql = `
        WITH open_so AS (
          SELECT Nomor
          FROM (
            SELECT
              y.Nomor,
              CASE
                WHEN y.sts <> 0 THEN 'DICLOSE'
                WHEN y.StatusKirim = 'TERKIRIM' THEN 'CLOSE'
                WHEN y.StatusKirim = 'BELUM' AND y.keluar = 0 AND y.minta = '' AND y.pesan = 0 THEN 'OPEN'
                ELSE 'PROSES'
              END AS StatusFinal
            FROM (
              SELECT
                x.*,
                IF(x.QtyInv = 0, 'BELUM', IF(x.QtyInv >= x.QtySO, 'TERKIRIM', 'SEBAGIAN')) AS StatusKirim,
                IFNULL((
                  SELECT SUM(m.mst_stok_out)
                  FROM tmasterstok m
                  WHERE m.mst_noreferensi IN (
                    SELECT o.mo_nomor FROM tmutasiout_hdr o WHERE o.mo_so_nomor = x.Nomor
                  )
                ), 0) AS keluar,
                IFNULL((
                  SELECT mt_nomor FROM tmintabarang_hdr WHERE mt_so = x.Nomor LIMIT 1
                ), '') AS minta,
                IFNULL((
                  SELECT SUM(mst_stok_in - mst_stok_out)
                  FROM tmasterstokso
                  WHERE mst_aktif = 'Y' AND mst_nomor_so = x.Nomor
                ), 0) AS pesan
              FROM (
                SELECT
                  h.so_nomor AS Nomor,
                  h.so_close AS sts,
                  IFNULL((SELECT SUM(dd.sod_jumlah) FROM tso_dtl dd WHERE dd.sod_so_nomor = h.so_nomor), 0) AS QtySO,
                  IFNULL((
                    SELECT SUM(dd.invd_jumlah)
                    FROM tinv_hdr hh
                    JOIN tinv_dtl dd ON dd.invd_inv_nomor = hh.inv_nomor
                    WHERE hh.inv_sts_pro = 0 AND hh.inv_nomor_so = h.so_nomor
                  ), 0) AS QtyInv
                FROM tso_hdr h
                WHERE h.so_close = 0 AND h.so_aktif = 'Y' AND h.so_cab = ?
              ) x
            ) y
          ) z
          WHERE z.StatusFinal = 'OPEN'
        ),
        pesanan_booked_summary AS (
          SELECT d.sod_kode AS kode, SUM(d.sod_jumlah - IFNULL(d.sod_scanned, 0)) AS booked
          FROM open_so os
          JOIN tso_dtl d ON d.sod_so_nomor = os.Nomor
          WHERE d.sod_jumlah > IFNULL(d.sod_scanned, 0)
          GROUP BY d.sod_kode
        )
      `;
      pesananParamsPre.push(gudang);

      pesananSelectSql = `
        , IFNULL(pb.booked, 0) AS PESANAN_BOOKED
        , IFNULL((
            SELECT SUM(mso.mst_stok_in - mso.mst_stok_out)
            FROM tmasterstokso mso
            WHERE mso.mst_brg_kode = a.brg_kode AND mso.mst_cab = ? AND mso.mst_aktif = 'Y'
          ), 0) AS PESANAN_READY
      `;
      pesananParamsSelect.push(gudang);

      pesananJoinSql = `LEFT JOIN pesanan_booked_summary pb ON pb.kode = a.brg_kode`;
    }

    // =================================================================================
    // Susun Array Parameter Utama sesuai urutan kemunculan '?' di SQL
    // =================================================================================
    let mainParams = [];

    // Urutan 0 (BARU): Parameter CTE Pesanan (WITH ... AS, muncul paling awal di teks SQL)
    mainParams.push(...pesananParamsPre);

    // Urutan 1: Parameter untuk Buffer (di dalam SELECT)
    let bufferSubquery = "";
    if (gudang === "KDC") {
      bufferSubquery = `IFNULL((SELECT SUM(brgd_mindc) FROM tbarangdc_dtl b WHERE b.brgd_kode = a.brg_kode), 0)`;
    } else if (gudang !== "ALL") {
      bufferSubquery = `IFNULL((SELECT SUM(brgd_min) FROM tbarangdc_dtl2 b2 WHERE b2.brgd_kode = a.brg_kode AND b2.brgd_cab = ?), 0)`;
      mainParams.push(gudang);
    } else {
      bufferSubquery = `IFNULL((SELECT SUM(brgd_min) FROM tbarangdc_dtl2 b2 WHERE b2.brgd_kode = a.brg_kode), 0)`;
    }

    // Urutan 1b (BARU): Parameter subquery PESANAN_READY (muncul di SELECT, setelah Buffer)
    mainParams.push(...pesananParamsSelect);

    // Urutan 2: Parameter untuk Tanggal & Gudang (di dalam LEFT JOIN stok)
    mainParams.push(tanggal);
    if (gudang !== "ALL") {
      mainParams.push(gudang);
    }

    // Urutan 3: Parameter untuk WHERE (Kode & Search)
    mainParams.push(...kodeParams);
    mainParams.push(...searchParams);

    const havingClause = !tampilkanKosong ? "HAVING TOTAL <> 0" : "";
    const isKDC = gudang === "KDC" ? 1 : 0;

    const query = `
        ${pesananCTESql}
        SELECT
            a.brg_kode AS KODE,
            a.brg_ktgp AS KATEGORI,
            TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna)) AS NAMA
            
            ${dynamicColumns}  
            
            , SUM(s.stok) AS TOTAL
            , IF(${isKDC}, 
            IFNULL((
              SELECT SUM(pld.pld_jumlah) 
              FROM tpacking_list_dtl pld
              JOIN tpacking_list_hdr plh ON pld.pld_nomor = plh.pl_nomor
              WHERE pld.pld_kode = a.brg_kode AND plh.pl_status = 'O'
            ), 0), 
          0) AS PL
        , (SUM(s.stok) - IF(${isKDC}, 
            IFNULL((SELECT SUM(pld.pld_jumlah) FROM tpacking_list_dtl pld 
                    JOIN tpacking_list_hdr plh ON pld.pld_nomor = plh.pl_nomor 
                    WHERE pld.pld_kode = a.brg_kode AND plh.pl_status = 'O'), 0), 
          0)) AS TOTAL2
          
            , ${bufferSubquery} AS Buffer
            ${pesananSelectSql}
        FROM tbarangdc a
        LEFT JOIN (
            SELECT 
                m.mst_brg_kode, 
                m.mst_ukuran, 
                SUM(m.mst_stok_in - m.mst_stok_out) as stok
            FROM ${stockSourceTable} m
            WHERE m.mst_aktif = 'Y' AND m.mst_tanggal <= ? AND ${gudangFilter}
            GROUP BY m.mst_brg_kode, m.mst_ukuran
        ) s ON a.brg_kode = s.mst_brg_kode
        ${pesananJoinSql}
        WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y' ${kodeBarangFilter} ${searchFilter}
        GROUP BY a.brg_kode, a.brg_ktgp, NAMA
        ${havingClause}
        ORDER BY NAMA;
    `;
    const [rows] = await connection.query(query, mainParams);
    return rows;
  } finally {
    connection.release();
  }
};

const getGudangOptions = async (user) => {
  let query = "";
  if (user.cabang === "KDC") {
    query = `
            SELECT 'ALL' AS kode, 'SEMUA' AS nama
            UNION ALL
            SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang ORDER BY kode;
        `;
  } else {
    query =
      'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode="KDC" OR gdg_kode = ?';
  }
  const [rows] = await pool.query(query, [user.cabang]);
  return rows;
};

const getLowStock = async (filters) => {
  const { gudang } = filters;
  const connection = await pool.getConnection();

  try {
    const threeMonthsAgo = format(subMonths(new Date(), 3), "yyyy-MM-dd");
    const today = format(new Date(), "yyyy-MM-dd");

    let params = [today, gudang, threeMonthsAgo];

    let gudangFilter = `m.mst_cab = ?`;
    let salesBranchFilter = `AND h.inv_cab = ?`;

    if (gudang === "KDC") {
      params.push(gudang);
    } else {
      params.push(gudang);
    }

    const query = `
            SELECT
                a.brg_kode AS KODE,
                b.brgd_barcode AS BARCODE,
                b.brgd_ukuran AS UKURAN, 
                
                TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna)) AS NAMA,
                
                IFNULL(s.stok, 0) AS TOTAL,
                IFNULL(b.brgd_min, 0) AS Buffer,
                IFNULL(sales.total_qty, 0) / 3 AS AVG_SALE

            FROM tbarangdc a
            JOIN tbarangdc_dtl b ON a.brg_kode = b.brgd_kode
            
            LEFT JOIN (
                SELECT 
                    m.mst_brg_kode, 
                    m.mst_ukuran, 
                    SUM(m.mst_stok_in - m.mst_stok_out) as stok
                FROM (
                    SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif FROM tmasterstok
                    UNION ALL
                    SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif FROM tmasterstokso
                ) m
                WHERE m.mst_aktif = 'Y' AND m.mst_tanggal <= ? AND ${gudangFilter}
                GROUP BY m.mst_brg_kode, m.mst_ukuran
            ) s ON a.brg_kode = s.mst_brg_kode AND b.brgd_ukuran = s.mst_ukuran 

            LEFT JOIN (
                SELECT 
                    d.invd_kode,
                    d.invd_ukuran, 
                    SUM(d.invd_jumlah) as total_qty
                FROM tinv_hdr h
                JOIN tinv_dtl d ON h.inv_nomor = d.invd_inv_nomor
                WHERE h.inv_sts_pro = 0 
                  AND h.inv_tanggal >= ? 
                  ${salesBranchFilter}
                GROUP BY d.invd_kode, d.invd_ukuran
            ) sales ON a.brg_kode = sales.invd_kode AND b.brgd_ukuran = sales.invd_ukuran 

            WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
            
            HAVING TOTAL <= 0 AND AVG_SALE > 0
            
            ORDER BY AVG_SALE DESC
            LIMIT 20;
        `;

    const [rows] = await connection.query(query, params);
    return rows;
  } finally {
    connection.release();
  }
};

const getRealTimeStockExport = async (filters) => {
  const { gudang, kodeBarang, keyword, jenisStok, tampilkanKosong, tanggal } =
    filters;
  const connection = await pool.getConnection();

  try {
    const isShowZero = String(tampilkanKosong) === "true";

    // [BARU] Sama seperti getRealTimeStock — reuse logic Pesanan Ready/Booked
    const isStoreMode = gudang !== "ALL" && gudang !== "KDC";
    let pesananCTESql = "";
    let pesananSelectSql = "";
    let pesananJoinSql = "";
    const pesananParamsPre = [];
    const pesananParamsSelect = [];

    if (isStoreMode) {
      pesananCTESql = `
        WITH open_so AS (
          SELECT Nomor
          FROM (
            SELECT
              y.Nomor,
              CASE
                WHEN y.sts <> 0 THEN 'DICLOSE'
                WHEN y.StatusKirim = 'TERKIRIM' THEN 'CLOSE'
                WHEN y.StatusKirim = 'BELUM' AND y.keluar = 0 AND y.minta = '' AND y.pesan = 0 THEN 'OPEN'
                ELSE 'PROSES'
              END AS StatusFinal
            FROM (
              SELECT
                x.*,
                IF(x.QtyInv = 0, 'BELUM', IF(x.QtyInv >= x.QtySO, 'TERKIRIM', 'SEBAGIAN')) AS StatusKirim,
                IFNULL((
                  SELECT SUM(m.mst_stok_out)
                  FROM tmasterstok m
                  WHERE m.mst_noreferensi IN (
                    SELECT o.mo_nomor FROM tmutasiout_hdr o WHERE o.mo_so_nomor = x.Nomor
                  )
                ), 0) AS keluar,
                IFNULL((
                  SELECT mt_nomor FROM tmintabarang_hdr WHERE mt_so = x.Nomor LIMIT 1
                ), '') AS minta,
                IFNULL((
                  SELECT SUM(mst_stok_in - mst_stok_out)
                  FROM tmasterstokso
                  WHERE mst_aktif = 'Y' AND mst_nomor_so = x.Nomor
                ), 0) AS pesan
              FROM (
                SELECT
                  h.so_nomor AS Nomor,
                  h.so_close AS sts,
                  IFNULL((SELECT SUM(dd.sod_jumlah) FROM tso_dtl dd WHERE dd.sod_so_nomor = h.so_nomor), 0) AS QtySO,
                  IFNULL((
                    SELECT SUM(dd.invd_jumlah)
                    FROM tinv_hdr hh
                    JOIN tinv_dtl dd ON dd.invd_inv_nomor = hh.inv_nomor
                    WHERE hh.inv_sts_pro = 0 AND hh.inv_nomor_so = h.so_nomor
                  ), 0) AS QtyInv
                FROM tso_hdr h
                WHERE h.so_close = 0 AND h.so_aktif = 'Y' AND h.so_cab = ?
              ) x
            ) y
          ) z
          WHERE z.StatusFinal = 'OPEN'
        ),
        pesanan_booked_summary AS (
          SELECT d.sod_kode AS kode, d.sod_ukuran AS ukuran,
                 SUM(d.sod_jumlah - IFNULL(d.sod_scanned, 0)) AS booked
          FROM open_so os
          JOIN tso_dtl d ON d.sod_so_nomor = os.Nomor
          WHERE d.sod_jumlah > IFNULL(d.sod_scanned, 0)
          GROUP BY d.sod_kode, d.sod_ukuran
        )
      `;
      pesananParamsPre.push(gudang);

      pesananSelectSql = `
        , IFNULL(pb.booked, 0) AS PESANAN_BOOKED
        , IFNULL((
            SELECT SUM(mso.mst_stok_in - mso.mst_stok_out)
            FROM tmasterstokso mso
            WHERE mso.mst_brg_kode = a.brg_kode
              AND mso.mst_ukuran = b.brgd_ukuran
              AND mso.mst_cab = ? AND mso.mst_aktif = 'Y'
          ), 0) AS PESANAN_READY
      `;
      pesananParamsSelect.push(gudang);

      // [FIX] Join sekarang per (kode, ukuran) — sebelumnya cuma per kode,
      // jadi total booked/ready kode itu "ditempel" sama di semua baris
      // ukuran (bug: angka totalnya nempel di setiap size, bukan dipecah).
      pesananJoinSql = `LEFT JOIN pesanan_booked_summary pb ON pb.kode = a.brg_kode AND pb.ukuran = b.brgd_ukuran`;
    }

    let stockSourceTable = "";
    if (jenisStok === "showroom") {
      stockSourceTable = "tmasterstok";
    } else if (jenisStok === "pesanan") {
      stockSourceTable = "tmasterstokso";
    } else {
      stockSourceTable = `(
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif 
        FROM tmasterstok
        UNION ALL
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif 
        FROM tmasterstokso
      )`;
    }

    let gudangFilter = "1 = 1";
    let kodeBarangFilter = "";
    let searchFilter = "";

    if (gudang !== "ALL") gudangFilter = `m.mst_cab = ?`;
    if (kodeBarang && kodeBarang.trim() !== "")
      kodeBarangFilter = " AND a.brg_kode = ? ";
    if (keyword && keyword.trim() !== "") {
      searchFilter = ` AND (a.brg_kode LIKE ? OR TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna)) LIKE ?)`;
    }

    const isKDC = gudang === "KDC" ? 1 : 0;

    // =================================================================================
    // [PERBAIKAN KUNCI]: Susun Array Parameter Export
    // =================================================================================
    let exportParams = [];

    // Urutan 0 (BARU): Parameter CTE Pesanan
    exportParams.push(...pesananParamsPre);

    // Urutan 1: Parameter SELECT (Buffer Min & Max)
    let bufferMinSubquery = "";
    let bufferMaxSubquery = "";

    if (gudang === "KDC") {
      bufferMinSubquery = "COALESCE(b.brgd_mindc, 0)";
      bufferMaxSubquery = "COALESCE(b.brgd_maxdc, 0)";
    } else if (gudang !== "ALL") {
      bufferMinSubquery = `IFNULL((SELECT b2.brgd_min FROM tbarangdc_dtl2 b2 WHERE b2.brgd_kode = b.brgd_kode AND b2.brgd_ukuran = b.brgd_ukuran AND b2.brgd_cab = ? LIMIT 1), 0)`;
      bufferMaxSubquery = `IFNULL((SELECT b2.brgd_max FROM tbarangdc_dtl2 b2 WHERE b2.brgd_kode = b.brgd_kode AND b2.brgd_ukuran = b.brgd_ukuran AND b2.brgd_cab = ? LIMIT 1), 0)`;
      exportParams.push(gudang, gudang); // <-- Masuk pertama (Untuk subquery Min dan Max)
    } else {
      bufferMinSubquery = `IFNULL((SELECT SUM(b2.brgd_min) FROM tbarangdc_dtl2 b2 WHERE b2.brgd_kode = b.brgd_kode AND b2.brgd_ukuran = b.brgd_ukuran), 0)`;
      bufferMaxSubquery = `IFNULL((SELECT SUM(b2.brgd_max) FROM tbarangdc_dtl2 b2 WHERE b2.brgd_kode = b.brgd_kode AND b2.brgd_ukuran = b.brgd_ukuran), 0)`;
    }

    // Urutan 1b (BARU): Parameter subquery PESANAN_READY
    exportParams.push(...pesananParamsSelect);

    // Urutan 2: Parameter LEFT JOIN (Tanggal & Gudang)
    exportParams.push(tanggal);
    if (gudang !== "ALL") {
      exportParams.push(gudang);
    }

    // Urutan 3: Parameter WHERE
    if (kodeBarang && kodeBarang.trim() !== "") exportParams.push(kodeBarang);
    if (keyword && keyword.trim() !== "") {
      const searchTerm = `%${keyword.trim()}%`;
      exportParams.push(searchTerm, searchTerm);
    }

    const query = `
        ${pesananCTESql}
        SELECT
            a.brg_kode AS KODE,
            a.brg_ktgp AS KATEGORI,
            b.brgd_barcode AS BARCODE,
            TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna)) AS NAMA,
            b.brgd_ukuran AS UKURAN,
            b.brgd_hpp AS HPP,
            COALESCE(s.stok, 0) AS TOTAL,
            IF(${isKDC}, 
            IFNULL((
                SELECT SUM(pld.pld_jumlah) 
                FROM tpacking_list_dtl pld
                JOIN tpacking_list_hdr plh ON pld.pld_nomor = plh.pl_nomor
                WHERE pld.pld_kode = a.brg_kode AND pld.pld_ukuran = b.brgd_ukuran AND plh.pl_status = 'O'
            ), 0),
        0) AS PL_QTY,

            (COALESCE(s.stok, 0) - IF(${isKDC}, 
                IFNULL((
                    SELECT SUM(pld.pld_jumlah) 
                    FROM tpacking_list_dtl pld
                    JOIN tpacking_list_hdr plh ON pld.pld_nomor = plh.pl_nomor
                    WHERE pld.pld_kode = a.brg_kode AND pld.pld_ukuran = b.brgd_ukuran AND plh.pl_status = 'O'
                ), 0),
            0)) AS TOTAL2,
        
            ${bufferMinSubquery} AS BUFFER_MIN,
            ${bufferMaxSubquery} AS BUFFER_MAX
            ${pesananSelectSql}
            
        FROM tbarangdc a
        JOIN tbarangdc_dtl b ON a.brg_kode = b.brgd_kode
        LEFT JOIN (
            SELECT 
                m.mst_brg_kode, 
                m.mst_ukuran, 
                SUM(m.mst_stok_in - m.mst_stok_out) as stok
            FROM ${stockSourceTable} m
            WHERE m.mst_aktif = 'Y' AND m.mst_tanggal <= ? AND ${gudangFilter}
            GROUP BY m.mst_brg_kode, m.mst_ukuran
        ) s ON b.brgd_kode = s.mst_brg_kode AND b.brgd_ukuran = s.mst_ukuran
        ${pesananJoinSql}
        WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y' ${kodeBarangFilter} ${searchFilter}
        
        ${!isShowZero ? "HAVING TOTAL <> 0" : ""}
        
        ORDER BY NAMA, b.brgd_ukuran;
    `;

    const [rows] = await connection.query(query, exportParams);
    return rows;
  } finally {
    connection.release();
  }
};

const getPesananBookedDetail = async (kode, cabang) => {
  const connection = await pool.getConnection();
  try {
    const query = `
      WITH open_so AS (
        SELECT Nomor
        FROM (
          SELECT
            y.Nomor,
            CASE
              WHEN y.sts <> 0 THEN 'DICLOSE'
              WHEN y.StatusKirim = 'TERKIRIM' THEN 'CLOSE'
              WHEN y.StatusKirim = 'BELUM' AND y.keluar = 0 AND y.minta = '' AND y.pesan = 0 THEN 'OPEN'
              ELSE 'PROSES'
            END AS StatusFinal
          FROM (
            SELECT
              x.*,
              IF(x.QtyInv = 0, 'BELUM', IF(x.QtyInv >= x.QtySO, 'TERKIRIM', 'SEBAGIAN')) AS StatusKirim,
              IFNULL((
                SELECT SUM(m.mst_stok_out)
                FROM tmasterstok m
                WHERE m.mst_noreferensi IN (
                  SELECT o.mo_nomor FROM tmutasiout_hdr o WHERE o.mo_so_nomor = x.Nomor
                )
              ), 0) AS keluar,
              IFNULL((
                SELECT mt_nomor FROM tmintabarang_hdr WHERE mt_so = x.Nomor LIMIT 1
              ), '') AS minta,
              IFNULL((
                SELECT SUM(mst_stok_in - mst_stok_out)
                FROM tmasterstokso
                WHERE mst_aktif = 'Y' AND mst_nomor_so = x.Nomor
              ), 0) AS pesan
            FROM (
              SELECT
                h.so_nomor AS Nomor,
                h.so_close AS sts,
                IFNULL((SELECT SUM(dd.sod_jumlah) FROM tso_dtl dd WHERE dd.sod_so_nomor = h.so_nomor), 0) AS QtySO,
                IFNULL((
                  SELECT SUM(dd.invd_jumlah)
                  FROM tinv_hdr hh
                  JOIN tinv_dtl dd ON dd.invd_inv_nomor = hh.inv_nomor
                  WHERE hh.inv_sts_pro = 0 AND hh.inv_nomor_so = h.so_nomor
                ), 0) AS QtyInv
              FROM tso_hdr h
              WHERE h.so_close = 0 AND h.so_aktif = 'Y' AND h.so_cab = ?
            ) x
          ) y
        ) z
        WHERE z.StatusFinal = 'OPEN'
      )
      SELECT
        h.so_nomor AS soNomor,
        h.so_tanggal AS tanggal,
        IFNULL(c.cus_nama, '-') AS customer,
        d.sod_ukuran AS ukuran,
        (d.sod_jumlah - IFNULL(d.sod_scanned, 0)) AS qty
      FROM open_so os
      JOIN tso_hdr h ON h.so_nomor = os.Nomor
      JOIN tso_dtl d ON d.sod_so_nomor = h.so_nomor
      LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
      WHERE d.sod_kode = ?
        AND d.sod_jumlah > IFNULL(d.sod_scanned, 0)
      ORDER BY h.so_tanggal DESC;
    `;
    const [rows] = await connection.query(query, [cabang, kode]);
    return rows;
  } finally {
    connection.release();
  }
};

// Detail per-SO dari stok yang SUDAH FISIK ADA di toko dan direservasi
// untuk SO tertentu (tmasterstokso) — pasangan dari getPesananBookedDetail
// yang sudah ada, tapi sumbernya beda (stok riil, bukan sisa outstanding SO).
const getPesananReadyDetail = async (kode, cabang) => {
  const connection = await pool.getConnection();
  try {
    const query = `
      SELECT 
        mso.mst_nomor_so AS soNomor,
        h.so_tanggal AS tanggal,
        IFNULL(c.cus_nama, '-') AS customer,
        mso.mst_ukuran AS ukuran,
        SUM(mso.mst_stok_in - mso.mst_stok_out) AS qty
      FROM tmasterstokso mso
      LEFT JOIN tso_hdr h ON h.so_nomor = mso.mst_nomor_so
      LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
      WHERE mso.mst_brg_kode = ?
        AND mso.mst_cab = ?
        AND mso.mst_aktif = 'Y'
      GROUP BY mso.mst_nomor_so, h.so_tanggal, c.cus_nama, mso.mst_ukuran
      HAVING qty <> 0
      ORDER BY h.so_tanggal DESC;
    `;
    const [rows] = await connection.query(query, [kode, cabang]);
    return rows;
  } finally {
    connection.release();
  }
};

const getPackingListDetail = async (kode) => {
  const connection = await pool.getConnection();
  try {
    const query = `
      SELECT
        plh.pl_nomor AS plNomor,
        plh.pl_tanggal AS tanggal,
        IFNULL(g.gdg_nama, plh.pl_cab_tujuan) AS tujuan,
        pld.pld_ukuran AS ukuran,
        pld.pld_jumlah AS qty
      FROM tpacking_list_dtl pld
      JOIN tpacking_list_hdr plh ON pld.pld_nomor = plh.pl_nomor
      LEFT JOIN tgudang g ON g.gdg_kode = plh.pl_cab_tujuan
      WHERE pld.pld_kode = ? AND plh.pl_status = 'O'
      ORDER BY plh.pl_tanggal DESC;
    `;
    const [rows] = await connection.query(query, [kode]);
    return rows;
  } finally {
    connection.release();
  }
};

module.exports = {
  getRealTimeStock,
  getGudangOptions,
  getLowStock,
  getRealTimeStockExport,
  getPesananBookedDetail,
  getPesananReadyDetail,
  getPackingListDetail,
};
