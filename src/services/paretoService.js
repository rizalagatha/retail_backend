const pool = require("../config/database");

/**
 * Mengambil data Laporan Pareto Barang Terjual.
 * Query ini adalah optimasi dari alur multi-langkah di Delphi.
 */
const getList = async (filters) => {
  const { startDate, endDate, cabang, kategori, limit, search } = filters;

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

  // Tentukan Output Kolom Cabang (Jika ALL, tulis ALL saja)
  const selectCab = cabang === "ALL" ? "'ALL'" : "LEFT(h.inv_nomor, 3)";

  const query = `
    SELECT
        ${selectCab} AS Cab,
        a.brg_kode AS KODE,
        a.brg_ktgp AS KTGPRODUK,
        a.brg_ktg AS KTGBRG,
        TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), " ", IFNULL(a.brg_tipe,''), " ", IFNULL(a.brg_lengan,''), " ", IFNULL(a.brg_jeniskain,''), " ", IFNULL(a.brg_warna,''))) AS NAMA,
        
        -- Urutan Pivot Size Diperbaiki dari terkecil ke terbesar
        SUM(CASE WHEN d.invd_ukuran = 'XS' THEN d.invd_jumlah ELSE 0 END) AS XS,
        SUM(CASE WHEN d.invd_ukuran = 'S' THEN d.invd_jumlah ELSE 0 END) AS S,
        SUM(CASE WHEN d.invd_ukuran = 'M' THEN d.invd_jumlah ELSE 0 END) AS M,
        SUM(CASE WHEN d.invd_ukuran = 'L' THEN d.invd_jumlah ELSE 0 END) AS L,
        SUM(CASE WHEN d.invd_ukuran = 'XL' THEN d.invd_jumlah ELSE 0 END) AS XL,
        SUM(CASE WHEN d.invd_ukuran = '2XL' THEN d.invd_jumlah ELSE 0 END) AS \`2XL\`,
        SUM(CASE WHEN d.invd_ukuran = '3XL' THEN d.invd_jumlah ELSE 0 END) AS \`3XL\`,
        SUM(CASE WHEN d.invd_ukuran = '4XL' THEN d.invd_jumlah ELSE 0 END) AS \`4XL\`,
        SUM(CASE WHEN d.invd_ukuran = '5XL' THEN d.invd_jumlah ELSE 0 END) AS \`5XL\`,
        SUM(CASE WHEN d.invd_ukuran = 'ALLSIZE' THEN d.invd_jumlah ELSE 0 END) AS ALLSIZE,
        SUM(CASE WHEN d.invd_ukuran = 'OVERSIZE' THEN d.invd_jumlah ELSE 0 END) AS OVERSIZE,
        SUM(CASE WHEN d.invd_ukuran = 'JUMBO' THEN d.invd_jumlah ELSE 0 END) AS JUMBO,
        
        SUM(d.invd_jumlah) AS TOTAL,
        SUM(((d.invd_harga - d.invd_diskon) * d.invd_jumlah)) AS NOMINAL_SALES,

        -- Stok Pareto Subquery Dinamis
        IFNULL((
            SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
            FROM tmasterstok m 
            WHERE m.mst_aktif="Y" AND m.mst_brg_kode = a.brg_kode 
              AND m.mst_tanggal <= ? 
              ${subqueryCabFilter}
        ), 0) AS StokPareto,

        -- Stok Real Subquery Dinamis
        IFNULL((
            SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
            FROM tmasterstok m 
            WHERE m.mst_aktif="Y" AND m.mst_brg_kode = a.brg_kode 
              ${subqueryCabFilter}
        ), 0) AS StokReal
        
    FROM tinv_hdr h
    INNER JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
    INNER JOIN tbarangdc a ON a.brg_kode = d.invd_kode
    WHERE h.inv_sts_pro = 0 
      AND h.inv_tanggal BETWEEN ? AND ?
      AND a.brg_logstok = "Y"
      ${branchFilter}
      ${categoryFilter}
      ${searchFilter}
    -- [KUNCI PERBAIKAN] Tidak ada lagi grouping by cabang jika 'ALL'
    GROUP BY a.brg_kode, NAMA, KTGPRODUK, KTGBRG
    ORDER BY TOTAL DESC
    LIMIT ?
  `;

  const [rows] = await pool.query(query, params);
  return rows;
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

module.exports = {
  getList,
  getCabangOptions,
  getKategoriOptions,
};
