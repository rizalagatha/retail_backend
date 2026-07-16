const pool = require("../config/database");
const { get } = require("../routes/soRoutes");

/**
 * Mengambil data Laporan Pareto Barang Terjual.
 * Query ini adalah optimasi dari alur multi-langkah di Delphi.
 */
const getList = async (filters) => {
  const { startDate, endDate, cabang, kategori, limit, search, isExport } =
    filters;

  const shouldExport = isExport === true || isExport === "true";

  // Jika export dan ALL cabang, jalankan query per cabang
  if (shouldExport && cabang === "ALL") {
    return await getListPerCabang(filters);
  }

  let params = [];
  let subqueryCabFilter = "";
  let branchFilter = "";
  let categoryFilter = "";
  let searchFilter = "";

  // 1. Parameter untuk Subquery Stok Pareto & Stok Real
  params.push(endDate);
  if (cabang !== "ALL") {
    subqueryCabFilter = "AND m.mst_cab = ?";
    params.push(cabang); // Untuk Stok Pareto
    params.push(cabang); // Untuk Stok Real
  }

  // 2. Parameter untuk Tanggal Main Query
  params.push(startDate, endDate);

  // 3. Parameter untuk Filter Cabang Main Query
  if (cabang !== "ALL") {
    branchFilter = "AND LEFT(h.inv_nomor, 3) = ?";
    params.push(cabang);
  }

  // 4. Parameter untuk Kategori
  if (kategori !== "ALL") {
    categoryFilter = "AND a.brg_ktgp = ?";
    params.push(kategori);
  }

  // 5. Parameter untuk Pencarian
  if (search) {
    const searchTerm = `%${search}%`;
    searchFilter = `
      AND (
        a.brg_kode LIKE ? 
        OR CONCAT(IFNULL(a.brg_jeniskaos,''), " ", IFNULL(a.brg_tipe,''), " ", IFNULL(a.brg_lengan,''), " ", IFNULL(a.brg_jeniskain,''), " ", IFNULL(a.brg_warna,'')) LIKE ?
      )
    `;
    params.push(searchTerm, searchTerm);
  }

  // 6. Parameter untuk Limit
  params.push(parseInt(limit, 10) || 20);

  const selectCab = cabang === "ALL" ? "'ALL'" : `'${cabang}'`;

  const query = `
    SELECT
        ${selectCab} AS Cab,
        x.KODE,
        x.KTGPRODUK,
        x.KTGBRG,
        x.NAMA,
        
        SUM(CASE WHEN x.UKURAN = 'XS' THEN x.qty ELSE 0 END) AS XS,
        SUM(CASE WHEN x.UKURAN = 'S' THEN x.qty ELSE 0 END) AS S,
        SUM(CASE WHEN x.UKURAN = 'M' THEN x.qty ELSE 0 END) AS M,
        SUM(CASE WHEN x.UKURAN = 'L' THEN x.qty ELSE 0 END) AS L,
        SUM(CASE WHEN x.UKURAN = 'XL' THEN x.qty ELSE 0 END) AS XL,
        SUM(CASE WHEN x.UKURAN = '2XL' THEN x.qty ELSE 0 END) AS \`2XL\`,
        SUM(CASE WHEN x.UKURAN = '3XL' THEN x.qty ELSE 0 END) AS \`3XL\`,
        SUM(CASE WHEN x.UKURAN = '4XL' THEN x.qty ELSE 0 END) AS \`4XL\`,
        SUM(CASE WHEN x.UKURAN = '5XL' THEN x.qty ELSE 0 END) AS \`5XL\`,
        SUM(CASE WHEN x.UKURAN = 'ALLSIZE' THEN x.qty ELSE 0 END) AS ALLSIZE,
        SUM(CASE WHEN x.UKURAN = 'OVERSIZE' THEN x.qty ELSE 0 END) AS OVERSIZE,
        SUM(CASE WHEN x.UKURAN = 'JUMBO' THEN x.qty ELSE 0 END) AS JUMBO,
        
        SUM(x.qty) AS TOTAL,
        
        -- Kita jumlahkan field yang sudah digodok matang di Subquery bawah
        SUM(x.netto_baris) AS NOMINAL_SALES,

        IFNULL((
            SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
            FROM tmasterstok m 
            WHERE m.mst_aktif="Y" AND m.mst_brg_kode = x.KODE 
              AND m.mst_tanggal <= ? 
              ${subqueryCabFilter}
        ), 0) AS StokPareto,

        IFNULL((
            SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
            FROM tmasterstok m 
            WHERE m.mst_aktif="Y" AND m.mst_brg_kode = x.KODE 
              ${subqueryCabFilter}
        ), 0) AS StokReal
        
    FROM (
        -- [SUBQUERY] Menghitung angka secara akurat per baris transaksi
        SELECT 
            a.brg_kode AS KODE,
            a.brg_ktgp AS KTGPRODUK,
            a.brg_ktg AS KTGBRG,
            TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), " ", IFNULL(a.brg_tipe,''), " ", IFNULL(a.brg_lengan,''), " ", IFNULL(a.brg_jeniskain,''), " ", IFNULL(a.brg_warna,''))) AS NAMA,
            d.invd_ukuran AS UKURAN,
            d.invd_jumlah AS qty,
            -- Eksekusi perkaian Harga & Qty di sini secara absolut
            ((IFNULL(d.invd_harga, 0) - IFNULL(d.invd_diskon, 0)) * IFNULL(d.invd_jumlah, 0)) AS netto_baris
        FROM tinv_hdr h
        INNER JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
        INNER JOIN tbarangdc a ON a.brg_kode = d.invd_kode
        WHERE h.inv_sts_pro = 0 
          AND h.inv_tanggal BETWEEN ? AND ?
          AND a.brg_logstok = "Y"
          AND a.brg_kode != '2500053'
          ${branchFilter}
          ${categoryFilter}
          ${searchFilter}
    ) AS x
    GROUP BY x.KODE, x.NAMA, x.KTGPRODUK, x.KTGBRG
    ORDER BY TOTAL DESC
    LIMIT ?
  `;

  const [rows] = await pool.query(query, params);
  return rows;
};

const getListPerCabang = async (filters) => {
  const { startDate, endDate, kategori, limit, search } = filters;

  // Ambil semua cabang aktif
  const [cabangRows] = await pool.query(
    "SELECT gdg_kode FROM tgudang WHERE gdg_dc = 0 ORDER BY gdg_kode",
  );

  const results = [];

  for (const { gdg_kode } of cabangRows) {
    const rows = await getList({
      startDate,
      endDate,
      cabang: gdg_kode,
      kategori,
      limit: 99999, // ← ambil semua dulu, sort & limit di akhir
      search,
      isExport: false,
    });

    rows.forEach((r) => {
      results.push({ ...r, Cab: gdg_kode });
    });
  }

  // Sort by TOTAL DESC, lalu ambil sesuai limit
  results.sort((a, b) => Number(b.TOTAL) - Number(a.TOTAL));

  const finalLimit = parseInt(limit, 10) || 50;
  return results.slice(0, finalLimit);
};

/**
 * Mengambil opsi cabang untuk filter Pareto.
 * Sesuai Delphi: Menampilkan semua cabang non-DC dan opsi "ALL".
 */
const getCabangOptions = async (user) => {
  let query;
  const params = [];

  if (user.cabang === "KDC") {
    query = `
            SELECT * FROM (
                (SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc = 0 ORDER BY gdg_kode)
                UNION ALL
                SELECT "ALL" AS kode, "SEMUA CABANG" AS nama
            ) x ORDER BY kode;
        `;
  } else {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?";
    params.push(user.cabang);
  }

  const [rows] = await pool.query(query, params);
  return rows;
};

const getKategoriOptions = async () => {
  const [rows] = await pool.query(
    "SELECT DISTINCT brg_ktgp FROM tbarangdc WHERE brg_ktgp <> '' ORDER BY brg_ktgp",
  );
  return ["ALL", ...rows.map((r) => r.brg_ktgp)];
};

/**
 * Mengambil data khusus untuk kebutuhan Export Excel multi-sheet Per Cabang.
 * Mengambil Top N Gabungan (Unik), Breakdown penjualannya per cabang untuk sheet 1,
 * dan Top 10 barang terlaris per cabang untuk sheet tambahan.
 */
const getDataForPerCabangExport = async (filters) => {
  const { startDate, endDate, kategori, search } = filters;
  const limit = parseInt(filters.limit, 10) || 50;

  // 1. Ambil Data Pareto Gabungan (Top N Barang Unik) untuk basis Sheet 1
  // Gunakan fungsi getList asli dengan Cab='ALL'
  const combinedPareto = await getList({
    startDate,
    endDate,
    cabang: "ALL",
    kategori,
    limit,
    search,
    isExport: false,
  });

  if (combinedPareto.length === 0)
    return { sheet1Data: [], perBranchTopSheets: [] };

  // Ambil list Kode Barang unik yang masuk Pareto
  const paretoItemKodes = combinedPareto.map((item) => item.KODE);

  let paramsDetail = [startDate, endDate, ...paretoItemKodes];
  let catFilter = "";
  if (kategori !== "ALL") {
    catFilter = "AND a.brg_ktgp = ?";
    paramsDetail.push(kategori);
  }

  // 2. Ambil DETAIL Penjualan per Cabang HANYA untuk barang-barang yang masuk combinedPareto
  // Ini untuk breakdown Sheet 1
  const queryBreakdown = `
    SELECT
        LEFT(x.inv_nomor, 3) AS Cab,
        x.KODE,
        x.KTGPRODUK,
        x.NAMA,
        SUM(x.qty) AS QTY_CABANG,
        SUM(x.netto_baris) AS NOMINAL_CABANG
    FROM (
        SELECT 
            h.inv_nomor,
            d.invd_kode AS KODE,
            a.brg_ktgp AS KTGPRODUK,
            TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), " ", IFNULL(a.brg_tipe,''), " ", IFNULL(a.brg_lengan,''), " ", IFNULL(a.brg_jeniskain,''), " ", IFNULL(a.brg_warna,''))) AS NAMA,
            d.invd_jumlah AS qty,
            ((IFNULL(d.invd_harga, 0) - IFNULL(d.invd_diskon, 0)) * IFNULL(d.invd_jumlah, 0)) AS netto_baris
        FROM tinv_hdr h
        INNER JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
        INNER JOIN tbarangdc a ON a.brg_kode = d.invd_kode
        WHERE h.inv_sts_pro = 0 
          AND h.inv_tanggal BETWEEN ? AND ?
          AND d.invd_kode IN (${paretoItemKodes.map(() => "?").join(",")}) -- Filter barang unik
          AND a.brg_logstok = "Y"
          AND a.brg_kode != '2500053'
          ${catFilter}
    ) AS x
    GROUP BY Cab, x.KODE, x.NAMA, x.KTGPRODUK
  `;

  const [breakdownRows] = await pool.query(queryBreakdown, paramsDetail);

  // Map hasil combinedPareto dengan breakdown per cabang untuk Sheet 1
  const sheet1Data = [];
  breakdownRows.forEach((bd) => {
    // Cari stok pareto & real dari combined data (data total barang unik)
    const totalData = combinedPareto.find((cp) => cp.KODE === bd.KODE);
    sheet1Data.push({
      Cab: bd.Cab,
      KODE: bd.KODE,
      KTGPRODUK: bd.KTGPRODUK,
      NAMA: bd.NAMA,
      TOTAL: bd.QTY_CABANG, // Qty terjual di cabang ini
      NOMINAL_SALES: bd.NOMINAL_CABANG, // Nominal di cabang ini
      StokPareto: totalData ? totalData.StokPareto : 0, // Stok total global
      StokReal: totalData ? totalData.StokReal : 0, // Stok total real global
    });
  });
  // Sort Sheet 1: Cabang (ASC), lalu Qty (DESC)
  sheet1Data.sort((a, b) => {
    if (a.Cab !== b.Cab) return a.Cab.localeCompare(b.Cab);
    return Number(b.TOTAL) - Number(a.TOTAL);
  });

  // 3. Ambil Data TOP 20 Barang Terlaris Masing-Masing Cabang (Untuk Sheet Tambahan)
  // Ambil opsi cabang DC=0 (bukan DC)
  const [cabangRows] = await pool.query(
    "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc = 0 ORDER BY gdg_kode",
  );

  const perBranchTopSheets = [];

  for (const branch of cabangRows) {
    // Panggil getList asli untuk cabang spesifik, limit Top 20
    const topItems = await getList({
      startDate,
      endDate,
      cabang: branch.kode,
      kategori,
      limit: 20, // Ambil Top 20 per cabang
      search: "", // Kosongkan search agar murni terlaris
      isExport: false,
    });

    if (topItems.length > 0) {
      perBranchTopSheets.push({
        kode_cabang: branch.kode,
        nama_cabang: branch.nama,
        data: topItems,
      });
    }
  }

  return { sheet1Data, perBranchTopSheets };
};

module.exports = {
  getList,
  getListPerCabang,
  getCabangOptions,
  getKategoriOptions,
  getDataForPerCabangExport,
};
