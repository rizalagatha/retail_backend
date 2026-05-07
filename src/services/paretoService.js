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

  params.push(endDate);
  if (cabang !== "ALL") {
    subqueryCabFilter = "AND m.mst_cab = ?";
    params.push(cabang);
    params.push(cabang);
  }

  params.push(startDate, endDate);

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
        OR CONCAT(IFNULL(a.brg_jeniskaos,''), " ", IFNULL(a.brg_tipe,''), " ", IFNULL(a.brg_lengan,''), " ", IFNULL(a.brg_jeniskain,''), " ", IFNULL(a.brg_warna,'')) LIKE ?
      )
    `;
    params.push(searchTerm, searchTerm);
  }

  params.push(parseInt(limit, 10) || 20);

  const selectCab = cabang === "ALL" ? "'ALL'" : "LEFT(h.inv_nomor, 3)";

  // [PERBAIKAN KUNCI]
  // Kita bungkus perhitungan d.invd_jumlah dan d.invd_harga di dalam subquery (Derived Table)
  // agar MySQL menjumlahkannya PER BARIS TRANSAKSI dengan tepat SEBELUM di-GROUP secara global.

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
        SUM(x.netto_baris) AS NOMINAL_SALES,

        -- Stok Pareto
        IFNULL((
            SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
            FROM tmasterstok m 
            WHERE m.mst_aktif="Y" AND m.mst_brg_kode = x.KODE 
              AND m.mst_tanggal <= ? 
              ${subqueryCabFilter}
        ), 0) AS StokPareto,

        -- Stok Real
        IFNULL((
            SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
            FROM tmasterstok m 
            WHERE m.mst_aktif="Y" AND m.mst_brg_kode = x.KODE 
              ${subqueryCabFilter}
        ), 0) AS StokReal
        
    FROM (
        -- [SUBQUERY] Menghitung angka secara akurat per baris detail terlebih dahulu
        SELECT 
            a.brg_kode AS KODE,
            a.brg_ktgp AS KTGPRODUK,
            a.brg_ktg AS KTGBRG,
            TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), " ", IFNULL(a.brg_tipe,''), " ", IFNULL(a.brg_lengan,''), " ", IFNULL(a.brg_jeniskain,''), " ", IFNULL(a.brg_warna,''))) AS NAMA,
            d.invd_ukuran AS UKURAN,
            d.invd_jumlah AS qty,
            -- Harga x Qty diproses mutlak di sini
            ((d.invd_harga - d.invd_diskon) * d.invd_jumlah) AS netto_baris,
            h.inv_nomor
        FROM tinv_hdr h
        INNER JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
        INNER JOIN tbarangdc a ON a.brg_kode = d.invd_kode
        WHERE h.inv_sts_pro = 0 
          AND h.inv_tanggal BETWEEN ? AND ?
          AND a.brg_logstok = "Y"
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
