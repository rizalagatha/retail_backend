const pool = require("../config/database");
const { format, subMonths } = require("date-fns");

const getRealTimeStock = async (filters) => {
  const { gudang, kodeBarang, jenisStok, tampilkanKosong, tanggal } = filters;
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

    // 2. Siapkan Filter Dasar
    let params = [tanggal];
    let gudangFilter = "1 = 1"; // Default ALL

    if (gudang !== "ALL") {
      gudangFilter = `m.mst_cab = ?`;
      params.push(gudang);
    }

    // 3. [LANGKAH BARU] Ambil Daftar Ukuran yang AKTIF/ADA STOKNYA SAJA
    // Kita cari ukuran yang stoknya tidak 0 pada periode ini
    const sizeQuery = `
      SELECT DISTINCT m.mst_ukuran
      FROM ${stockSourceTable} m
      LEFT JOIN tbarangdc a ON a.brg_kode = m.mst_brg_kode
      WHERE m.mst_aktif = 'Y' 
        AND m.mst_tanggal <= ? 
        AND ${gudangFilter}
        ${kodeBarang ? `AND m.mst_brg_kode = ?` : ""}
      ORDER BY m.mst_ukuran
    `;

    // Siapkan params untuk query size (sama dengan filter dasar + kode barang jika ada)
    const sizeParams = [...params];
    if (kodeBarang) sizeParams.push(kodeBarang);

    const [sizes] = await connection.query(sizeQuery, sizeParams);

    // 4. Rakit Kolom PIVOT secara Dinamis
    // Hasilnya: ", SUM(CASE WHEN s.mst_ukuran = 'S' THEN s.stok ELSE 0 END) AS 'S', ..."
    let dynamicColumns = "";

    if (sizes.length > 0) {
      dynamicColumns = sizes
        .map((row) => {
          // Sanitasi nama ukuran agar aman di SQL (cegah error spasi/karakter aneh)
          const sizeLabel = row.mst_ukuran.replace(/'/g, "''");
          return `SUM(CASE WHEN s.mst_ukuran = '${sizeLabel}' THEN s.stok ELSE 0 END) AS '${sizeLabel}'`;
        })
        .join(", \n");

      // Tambahkan koma di depan agar rapi saat digabung
      dynamicColumns = ", " + dynamicColumns;
    }

    // 5. Query Utama (Sekarang Menggunakan dynamicColumns)
    let mainParams = [...params]; // Reset params untuk query utama
    let kodeBarangFilter = "";
    if (kodeBarang) {
      kodeBarangFilter = "AND a.brg_kode = ?";
      mainParams.push(kodeBarang);
    }

    const havingClause = !tampilkanKosong ? "HAVING TOTAL > 0" : "";

    const isKDC = gudang === "KDC" ? 1 : 0;

    const query = `
        SELECT
            a.brg_kode AS KODE,
            a.brg_ktgp AS KATEGORI,
            TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna)) AS NAMA
            
            ${dynamicColumns}  -- <--- INI BAGIAN DINAMISNYA
            
            , SUM(s.stok) AS TOTAL
            -- [BARU] Hitung Total Qty di Packing List yang masih OPEN (Hanya untuk KDC)
            , IF(${isKDC}, 
            IFNULL((
              SELECT SUM(pld.pld_jumlah) 
              FROM tpacking_list_dtl pld
              JOIN tpacking_list_hdr plh ON pld.pld_nomor = plh.pl_nomor
              WHERE pld.pld_kode = a.brg_kode AND plh.pl_status = 'O'
            ), 0), 
          0) AS PL
          -- [BARU] Hitung Total 2 (Stok Bebas / Tersedia)
        , (SUM(s.stok) - IF(${isKDC}, 
            IFNULL((SELECT SUM(pld.pld_jumlah) FROM tpacking_list_dtl pld 
                    JOIN tpacking_list_hdr plh ON pld.pld_nomor = plh.pl_nomor 
                    WHERE pld.pld_kode = a.brg_kode AND plh.pl_status = 'O'), 0), 
          0)) AS TOTAL2
            , IFNULL((SELECT SUM(brgd_min) FROM tbarangdc_dtl b WHERE b.brgd_kode = a.brg_kode), 0) AS Buffer
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
        WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y' ${kodeBarangFilter}
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
                b.brgd_ukuran AS UKURAN, -- [BARU] Ambil Ukuran
                
                TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna)) AS NAMA,
                
                -- Stok Per Ukuran
                IFNULL(s.stok, 0) AS TOTAL,
                
                -- Buffer (Min Stok) per Ukuran
                IFNULL(b.brgd_min, 0) AS Buffer,
                
                -- Rata-rata Penjualan Per Ukuran
                IFNULL(sales.total_qty, 0) / 3 AS AVG_SALE

            FROM tbarangdc a
            -- [PENTING] Join ke tabel detail barang untuk memecah per ukuran
            JOIN tbarangdc_dtl b ON a.brg_kode = b.brgd_kode
            
            -- 1. JOIN KE STOK (Group by Kode + Ukuran)
            LEFT JOIN (
                SELECT 
                    m.mst_brg_kode, 
                    m.mst_ukuran, -- [BARU] Grouping Ukuran
                    SUM(m.mst_stok_in - m.mst_stok_out) as stok
                FROM (
                    SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif FROM tmasterstok
                    UNION ALL
                    SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif FROM tmasterstokso
                ) m
                WHERE m.mst_aktif = 'Y' AND m.mst_tanggal <= ? AND ${gudangFilter}
                GROUP BY m.mst_brg_kode, m.mst_ukuran
            ) s ON a.brg_kode = s.mst_brg_kode AND b.brgd_ukuran = s.mst_ukuran -- [BARU] Join Ukuran

            -- 2. JOIN KE PENJUALAN (Group by Kode + Ukuran)
            LEFT JOIN (
                SELECT 
                    d.invd_kode,
                    d.invd_ukuran, -- [BARU] Grouping Ukuran
                    SUM(d.invd_jumlah) as total_qty
                FROM tinv_hdr h
                JOIN tinv_dtl d ON h.inv_nomor = d.invd_inv_nomor
                WHERE h.inv_sts_pro = 0 
                  AND h.inv_tanggal >= ? 
                  ${salesBranchFilter}
                GROUP BY d.invd_kode, d.invd_ukuran
            ) sales ON a.brg_kode = sales.invd_kode AND b.brgd_ukuran = sales.invd_ukuran -- [BARU] Join Ukuran

            WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
            
            -- Filter hanya yang stoknya habis DAN laku
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
  const { gudang, kodeBarang, jenisStok, tampilkanKosong, tanggal } = filters;
  const connection = await pool.getConnection();

  try {
    // --- [FIX 1] KONVERSI STRING KE BOOLEAN ---
    // Karena query params via HTTP selalu string, "false" dianggap true object.
    const isShowZero = String(tampilkanKosong) === "true";

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

    // 2. Siapkan Parameter
    let params = [tanggal];

    let gudangFilter = "1 = 1";
    if (gudang !== "ALL") {
      gudangFilter = `m.mst_cab = ?`;
      params.push(gudang);
    }

    let kodeBarangFilter = "";
    if (kodeBarang) {
      kodeBarangFilter = "AND a.brg_kode = ?";
      params.push(kodeBarang);
    }

    const isKDC = gudang === "KDC" ? 1 : 0;

    // 3. Query Utama
    // Gunakan variabel 'isShowZero' yang sudah dikonversi
    const query = `
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

        -- [BARU] Kolom TOTAL2: Total Fisik dikurangi PL yang masih Open
            (COALESCE(s.stok, 0) - IF(${isKDC}, 
                IFNULL((
                    SELECT SUM(pld.pld_jumlah) 
                    FROM tpacking_list_dtl pld
                    JOIN tpacking_list_hdr plh ON pld.pld_nomor = plh.pl_nomor
                    WHERE pld.pld_kode = a.brg_kode AND pld.pld_ukuran = b.brgd_ukuran AND plh.pl_status = 'O'
                ), 0),
            0)) AS TOTAL2,
        
            COALESCE(b.brgd_min, 0) AS BUFFER
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
        WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y' ${kodeBarangFilter}
        
        -- [FIX 2] Gunakan isShowZero di sini
        ${!isShowZero ? "HAVING TOTAL > 0" : ""}
        
        ORDER BY NAMA, b.brgd_ukuran;
    `;

    const [rows] = await connection.query(query, params);
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
};
