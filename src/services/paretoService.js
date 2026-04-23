const pool = require("../config/database");

/**
 * Mengambil data Laporan Pareto Barang Terjual.
 * Query ini adalah optimasi dari alur multi-langkah di Delphi.
 */
const getList = async (filters) => {
  const { startDate, endDate, cabang, kategori, limit, search } = filters;

  // Siapkan parameter untuk query
  // Kita butuh endDate untuk StokPareto dan StokReal
  let params = [endDate, endDate, startDate, endDate];
  let branchFilter = "";
  let categoryFilter = "";
  let searchFilter = "";

  if (cabang !== "ALL") {
    branchFilter = "AND LEFT(h.inv_nomor, 3) = ?";
    params.push(cabang);
  }
  if (kategori !== "ALL") {
    categoryFilter = "AND a.brg_ktgp = ?";
    params.push(kategori);
  }

  if (search) {
    const searchTerm = `%${search}%`;
    searchFilter = `
      AND (
        a.brg_kode LIKE ? 
        OR CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna) LIKE ?
      )
    `;
    params.push(searchTerm, searchTerm);
  }

  // Parameter terakhir adalah limit untuk filter ranking
  params.push(parseInt(limit, 10) || 50);

  const query = `
    SELECT * FROM (
      SELECT
          LEFT(h.inv_nomor, 3) AS Cab,
          a.brg_kode AS KODE,
          a.brg_ktgp AS KTGPRODUK,
          a.brg_ktg AS KTGBRG,
          TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS NAMA,
          
          -- Perhitungan Qty per Ukuran
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
          SUM(((d.invd_harga - d.invd_diskon) * d.invd_jumlah)) AS NOMINAL_SALES,

          -- Subquery Stok (Pastikan param urutannya benar)
          IFNULL((
              SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
              FROM tmasterstok m 
              WHERE m.mst_aktif="Y" AND m.mst_brg_kode = a.brg_kode 
                AND m.mst_tanggal <= ? 
                AND m.mst_cab = LEFT(h.inv_nomor, 3)
          ), 0) AS StokPareto,

          IFNULL((
              SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
              FROM tmasterstok m 
              WHERE m.mst_aktif="Y" AND m.mst_brg_kode = a.brg_kode 
                AND m.mst_tanggal <= ? 
                AND m.mst_cab = LEFT(h.inv_nomor, 3)
          ), 0) AS StokReal,

          -- ==========================================================
          -- [JURUS PAMUNGKAS]: Bikin ranking per cabang
          -- ==========================================================
          ROW_NUMBER() OVER (PARTITION BY LEFT(h.inv_nomor, 3) ORDER BY SUM(d.invd_jumlah) DESC) as ranking

      FROM tinv_hdr h
      INNER JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
      INNER JOIN tbarangdc a ON a.brg_kode = d.invd_kode
      WHERE h.inv_sts_pro = 0 
        AND h.inv_tanggal BETWEEN ? AND ?
        AND a.brg_logstok = "Y"
        ${branchFilter}
        ${categoryFilter}
        ${searchFilter}
      GROUP BY LEFT(h.inv_nomor, 3), a.brg_kode, NAMA, KTGPRODUK, KTGBRG
    ) AS ResultInternal
    -- Ambil hanya yang masuk ranking sesuai filter limit (misal Top 50 tiap cabang)
    WHERE ResultInternal.ranking <= ?
    ORDER BY ResultInternal.Cab ASC, ResultInternal.TOTAL DESC
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
