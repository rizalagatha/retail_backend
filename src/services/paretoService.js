const pool = require("../config/database");

/**
 * Mengambil data Laporan Pareto Barang Terjual.
 * Query ini adalah optimasi dari alur multi-langkah di Delphi.
 */
const getList = async (filters) => {
  const { startDate, endDate, cabang, kategori, limit } = filters;

  let params = [endDate, startDate, endDate];

  let branchFilter = "";
  let categoryFilter = "";

  if (cabang !== "ALL") {
    branchFilter = "AND LEFT(h.inv_nomor, 3) = ?";
    params.push(cabang);
  }
  if (kategori !== "ALL") {
    categoryFilter = "AND a.brg_ktgp = ?";
    params.push(kategori);
  }
  params.push(parseInt(limit, 10) || 20);

  const query = `
        SELECT
            LEFT(h.inv_nomor, 3) AS Cab,
            a.brg_kode AS KODE,
            a.brg_ktgp AS KTGPRODUK,
            a.brg_ktg AS KTGBRG,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS NAMA,
            
            -- Pivoting a la Delphi
            SUM(CASE WHEN d.invd_ukuran = 'ALLSIZE' THEN d.invd_jumlah ELSE 0 END) AS ALLSIZE,
            SUM(CASE WHEN d.invd_ukuran = 'XS' THEN d.invd_jumlah ELSE 0 END) AS XS,
            SUM(CASE WHEN d.invd_ukuran = 'S' THEN d.invd_jumlah ELSE 0 END) AS S,
            SUM(CASE WHEN d.invd_ukuran = 'M' THEN d.invd_jumlah ELSE 0 END) AS M,
            SUM(CASE WHEN d.invd_ukuran = 'L' THEN d.invd_jumlah ELSE 0 END) AS L,
            SUM(CASE WHEN d.invd_ukuran = 'XL' THEN d.invd_jumlah ELSE 0 END) AS XL,
            SUM(CASE WHEN d.invd_ukuran = '2XL' THEN d.invd_jumlah ELSE 0 END) AS \`2XL\`,
            SUM(CASE WHEN d.invd_ukuran = '3XL' THEN d.invd_jumlah ELSE 0 END) AS \`3XL\`,
            SUM(CASE WHEN d.invd_ukuran = '4XL' THEN d.invd_jumlah ELSE 0 END) AS \`4XL\`,
            SUM(CASE WHEN d.invd_ukuran = '5XL' THEN d.invd_jumlah ELSE 0 END) AS \`5XL\`,
            SUM(CASE WHEN d.invd_ukuran = 'OVERSIZE' THEN d.invd_jumlah ELSE 0 END) AS OVERSIZE,
            SUM(CASE WHEN d.invd_ukuran = 'JUMBO' THEN d.invd_jumlah ELSE 0 END) AS JUMBO,
            SUM(d.invd_jumlah) AS TOTAL,
            
            -- Kalkulasi Nominal
            SUM(((d.invd_harga - d.invd_diskon) * d.invd_jumlah)) AS NOMINAL_SALES,

            -- <-- 2. ADDED STOK PARETO COLUMN (stock until end date)
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                FROM tmasterstok m 
                WHERE m.mst_aktif="Y" AND m.mst_brg_kode = a.brg_kode 
                  AND m.mst_tanggal <= ? 
                  AND m.mst_cab = LEFT(h.inv_nomor, 3) -- Filter cabang di dalam subquery
            ), 0) AS StokPareto,

            -- Subquery Stok Real (mengambil stok saat ini)
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                FROM tmasterstok m 
                WHERE m.mst_aktif="Y" AND m.mst_brg_kode = a.brg_kode 
                  AND m.mst_cab = LEFT(h.inv_nomor, 3) -- Filter cabang di dalam subquery
          ), 0) AS StokReal
        FROM tinv_hdr h
        INNER JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
        INNER JOIN tbarangdc a ON a.brg_kode = d.invd_kode
        WHERE h.inv_sts_pro = 0 
          AND h.inv_tanggal BETWEEN ? AND ?
          AND a.brg_logstok = "Y"
          ${branchFilter}
          ${categoryFilter}
        GROUP BY a.brg_kode, NAMA, KTGPRODUK, KTGBRG, LEFT(h.inv_nomor, 3)
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
    "SELECT DISTINCT brg_ktgp FROM tbarangdc WHERE brg_ktgp <> '' ORDER BY brg_ktgp"
  );
  return ["ALL", ...rows.map((r) => r.brg_ktgp)];
};

module.exports = {
  getList,
  getCabangOptions,
  getKategoriOptions,
};
