const pool = require("../config/database");

// Threshold kategori umur stok (dalam HARI, basis 30 hari/bulan —
// disamakan dengan kolom 'Umur (Bulan)' yang sudah ada: DATEDIFF/30)
const UMUR_THRESHOLD = {
  FAST_MOVING_MAX: 180, // < 6 bulan
  STANDAR_MAX: 540, // 6 - 18 bulan
  SLOW_MOVING_MAX: 1080, // 18 bulan - 3 tahun
  // >= 1080 hari (3 tahun) => Dead Stock
};

const buildBaseQuery = (branchFilter) => `
    SELECT 
        a.cabang, c.gdg_nama AS 'Nama Cabang',
        brg_ktgp AS 'KtgProduk', brg_ktg AS 'KtgBarang',
        a.Kelompok AS 'Kelompok Barang', a.JenisKain AS 'Jenis Kain',
        a.Warna AS 'Warna',
        a.kode AS 'Kode Barang', a.barcode AS 'Barcode', a.nama AS 'Nama Barang', a.ukuran AS 'Ukuran', a.stok AS 'Stok', 
        IFNULL(sls.total_sales, 0) AS 'RealSales',
        IFNULL(sls.avg_sales, 0) AS 'AvgSales',
        IFNULL(IFNULL(b_stbj.last_tanggal, b_sj.last_tanggal), '0000-00-00') AS 'Last Terima Tanggal', 
        IFNULL(IFNULL(b_stbj.last_nomor, b_sj.last_nomor), '-') AS 'No Dokumen Terima',
        CASE
            WHEN b_stbj.last_nomor IS NOT NULL THEN 'STBJ'
            WHEN b_sj.last_nomor IS NOT NULL THEN 'SJ'
            ELSE NULL
        END AS 'Sumber Terima',
        IFNULL(DATEDIFF(CURDATE(), IFNULL(b_stbj.last_tanggal, b_sj.last_tanggal)), 999) AS 'Umur (Hari)',
        IFNULL(FLOOR(DATEDIFF(CURDATE(), IFNULL(b_stbj.last_tanggal, b_sj.last_tanggal)) / 30), 33) AS 'Umur (Bulan)',
        IFNULL(FLOOR(DATEDIFF(CURDATE(), IFNULL(b_stbj.last_tanggal, b_sj.last_tanggal)) / 365), 2) AS 'Umur (Tahun)'
    FROM (
        SELECT 
            x.cabang, x.kode, brg_ktgp, brg_ktg,
            a.brg_lengan AS Kelompok, a.brg_jeniskain AS JenisKain,
            a.brg_warna AS Warna,
            dtl.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, ' ', a.brg_tipe, ' ', a.brg_lengan, ' ', a.brg_jeniskain, ' ', a.brg_warna)) AS Nama,
            x.Ukuran, x.Stok
        FROM (
            SELECT 
                m.mst_cab AS Cabang, m.mst_brg_kode AS Kode, m.mst_ukuran AS Ukuran,
                SUM(m.mst_stok_in - m.mst_stok_out) AS Stok
            FROM (
                SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif FROM tmasterstok
                UNION ALL
                SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif FROM tmasterstokso
            ) m
            WHERE m.mst_aktif = 'Y' ${branchFilter}
            GROUP BY m.mst_cab, m.mst_brg_kode, m.mst_ukuran
        ) x
        LEFT JOIN tbarangdc a ON a.brg_kode = x.kode
        LEFT JOIN tbarangdc_dtl dtl ON dtl.brgd_kode = x.kode AND dtl.brgd_ukuran = x.ukuran
        WHERE x.stok <> 0 
          AND a.brg_logstok = 'Y' 
          AND a.brg_aktif = 0
          AND a.brg_jeniskaos NOT LIKE '%STICKER%'
          AND a.brg_jeniskaos NOT LIKE '%STIKER%'
          AND a.brg_warna NOT LIKE '%STICKER%'
          AND a.brg_warna NOT LIKE '%STIKER%'
    ) a
    -- Sumber UTAMA (semua cabang): STBJ terakhir untuk SKU (kode+ukuran) ini,
    -- dicocokkan GLOBAL (bukan per cabang) — STBJ hanya terjadi di KDC saat
    -- produksi masuk, jadi tanggal ini merepresentasikan umur produksi SKU
    -- yang berlaku sama untuk toko manapun yang sedang memegang stok SKU itu.
    LEFT JOIN (
        SELECT 
            d.tsd_kode AS kode, d.tsd_ukuran AS ukuran,
            MAX(h.ts_tanggal) AS last_tanggal, MAX(h.ts_stbj) AS last_nomor
        FROM tdc_stbj_hdr h
        INNER JOIN tdc_stbj_dtl d ON d.tsd_nomor = h.ts_nomor
        GROUP BY 1, 2
    ) b_stbj ON (b_stbj.kode = a.kode AND b_stbj.ukuran = a.ukuran)
    -- Sumber FALLBACK (khusus toko): dipakai HANYA kalau SKU ini belum
    -- pernah punya catatan STBJ sama sekali (data lama sebelum STBJ tercatat)
    LEFT JOIN (
        SELECT 
            LEFT(tjd_nomor, 3) AS cabang, tjd_kode, tjd_ukuran, 
            MAX(tj_tanggal) AS last_tanggal, MAX(tj_nomor) AS last_nomor
        FROM ttrm_sj_hdr
        INNER JOIN ttrm_sj_dtl ON tjd_nomor = tj_nomor
        GROUP BY 1, 2, 3
    ) b_sj ON (b_sj.cabang = a.cabang AND b_sj.tjd_kode = a.kode AND b_sj.tjd_ukuran = a.ukuran)
    LEFT JOIN (
        SELECT 
            h.inv_cab, d.invd_kode, d.invd_ukuran,
            SUM(d.invd_jumlah) AS total_sales,
            (SUM(d.invd_jumlah) / ?) AS avg_sales
        FROM tinv_dtl d
        JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
        WHERE h.inv_sts_pro = 0 
          AND h.inv_tanggal >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
        GROUP BY 1, 2, 3
    ) sls ON (sls.inv_cab = a.cabang AND sls.invd_kode = a.kode AND sls.invd_ukuran = a.ukuran)
    LEFT JOIN tgudang c ON (c.gdg_kode = a.cabang)
    HAVING COALESCE(\`Umur (Hari)\`, 999) >= ?
`;

const getList = async (filters, user) => {
  const {
    cabang,
    minUmur,
    avgPeriod = 12,
    page = 1,
    pageSize = 50,
    all = false, // dipakai khusus buat export (ambil semua baris, tanpa LIMIT)
  } = filters;

  let branchFilter = "";
  const params = [];

  if (user.cabang !== "KDC") {
    branchFilter = `AND m.mst_cab = ?`;
    params.push(user.cabang);
  } else if (cabang !== "ALL") {
    branchFilter = `AND m.mst_cab = ?`;
    params.push(cabang);
  }

  const baseQuery = buildBaseQuery(branchFilter);
  const baseParams = [...params, avgPeriod, avgPeriod, minUmur];

  // Total count pakai query dasar yang SAMA PERSIS (base + params) supaya
  // jumlah total selalu konsisten dengan hasil data yang dipaginasi.
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM (${baseQuery}) countTable`,
    baseParams,
  );
  const total = countRows[0]?.total || 0;

  const isAll = all === true || all === "true";

  const dataQuery = `
    SELECT t.*,
      CASE
        WHEN t.\`Umur (Hari)\` >= ${UMUR_THRESHOLD.SLOW_MOVING_MAX} THEN 'Dead Stock'
        WHEN t.\`Umur (Hari)\` >= ${UMUR_THRESHOLD.STANDAR_MAX}     THEN 'Slow Moving'
        WHEN t.\`Umur (Hari)\` >= ${UMUR_THRESHOLD.FAST_MOVING_MAX} THEN 'Standar'
        ELSE 'Fast Moving'
      END AS \`Kategori Umur\`
    FROM (${baseQuery}) t
    ORDER BY t.\`Umur (Hari)\` DESC, t.cabang, t.\`Nama Barang\`
    ${isAll ? "" : "LIMIT ? OFFSET ?"}
  `;

  const dataParams = isAll
    ? baseParams
    : [...baseParams, Number(pageSize), (Number(page) - 1) * Number(pageSize)];

  const [rows] = await pool.query(dataQuery, dataParams);

  return { items: rows, total };
};

/**
 * Mengambil opsi cabang — untuk user KDC, tambahkan 'ALL' dan
 * DC Pusat (KDC) sendiri secara eksplisit karena gdg_dc = 0 hanya
 * mencakup toko reguler.
 */
const getCabangOptions = async (user) => {
  let query;
  const params = [];

  if (user.cabang === "KDC") {
    query = `
      SELECT kode, nama FROM (
        SELECT 'ALL' AS kode, 'SEMUA STORE' AS nama, 0 AS urutan
        UNION ALL
        SELECT gdg_kode AS kode, CONCAT(gdg_nama) AS nama, 1 AS urutan
        FROM tgudang WHERE gdg_kode = 'KDC'
        UNION ALL
        SELECT gdg_kode AS kode, gdg_nama AS nama, 2 AS urutan
        FROM tgudang WHERE gdg_dc = 0
      ) opts
      ORDER BY urutan, kode
    `;
  } else {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?";
    params.push(user.cabang);
  }

  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getCabangOptions,
};
