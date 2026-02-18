const pool = require("../config/database");

const getList = async (filters, user) => {
  const { cabang, minUmur, avgPeriod = 12 } = filters;
  let branchFilter = "";
  const params = [];

  if (user.cabang !== "KDC") {
    branchFilter = `AND m.mst_cab = ?`;
    params.push(user.cabang);
  } else if (cabang !== "ALL") {
    branchFilter = `AND m.mst_cab = ?`;
    params.push(cabang);
  }

  // Params untuk: pembagi sales, interval sales, minUmur
  const finalParams = [...params, avgPeriod, avgPeriod, minUmur];

  const query = `
        SELECT 
            a.cabang, c.gdg_nama AS 'Nama Cabang',
            brg_ktgp AS 'KtgProduk', brg_ktg AS 'KtgBarang',
            a.Kelompok AS 'Kelompok Barang', a.JenisKain AS 'Jenis Kain',
            a.Warna AS 'Warna',
            a.kode AS 'Kode Barang', a.barcode AS 'Barcode', a.nama AS 'Nama Barang', a.ukuran AS 'Ukuran', a.stok AS 'Stok', 
            IFNULL(sls.total_sales, 0) AS 'RealSales',
            IFNULL(sls.avg_sales, 0) AS 'AvgSales',
            IFNULL(b.last_tstbj, '0000-00-00') AS 'Last Terima STBJ/Tanggal', 
            IFNULL(b.last_nomor_tstbj, '-') AS 'No STBJ/SJ',
            -- Jika belum pernah ada STBJ, kita anggap umurnya sangat tua (999 hari) agar muncul
            IFNULL(DATEDIFF(CURDATE(), b.last_tstbj), 999) AS 'Umur (Hari)',
            IFNULL(FLOOR(DATEDIFF(CURDATE(), b.last_tstbj) / 30), 99) AS 'Umur (Bulan)'
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
                    -- [FIX 1] Gabungkan tabel Showroom dan Pesanan agar sinkron dengan Real Time
                    SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif FROM tmasterstok
                    UNION ALL
                    SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_aktif FROM tmasterstokso
                ) m
                WHERE m.mst_aktif = 'Y' ${branchFilter}
                GROUP BY m.mst_cab, m.mst_brg_kode, m.mst_ukuran
            ) x
            LEFT JOIN tbarangdc a ON a.brg_kode = x.kode
            LEFT JOIN tbarangdc_dtl dtl ON dtl.brgd_kode = x.kode AND dtl.brgd_ukuran = x.ukuran
            WHERE x.stok <> 0 AND a.brg_logstok = 'Y' AND a.brg_aktif = 0
        ) a
        LEFT JOIN (
            SELECT 
                LEFT(tjd_nomor, 3) AS cabang, tjd_kode, tjd_ukuran, 
                MAX(tj_tanggal) AS last_tstbj, MAX(tj_nomor) AS last_nomor_tstbj
            FROM ttrm_sj_hdr
            INNER JOIN ttrm_sj_dtl ON tjd_nomor = tj_nomor
            GROUP BY 1, 2, 3
        ) b ON (b.cabang = a.cabang AND b.tjd_kode = a.kode AND b.tjd_ukuran = a.ukuran)
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
        -- [FIX 2] Gunakan COALESCE pada HAVING agar nilai NULL (barang baru) tetap lolos filter
        HAVING COALESCE(\`Umur (Hari)\`, 999) >= ?
        ORDER BY \`Umur (Hari)\` DESC, a.cabang, a.nama;
    `;

  const [rows] = await pool.query(query, finalParams);
  return rows;
};

/**
 * Mengambil opsi cabang
 */
const getCabangOptions = async (user) => {
  let query;
  const params = [];
  if (user.cabang === "KDC") {
    query =
      "SELECT 'ALL' AS kode, 'SEMUA STORE' AS nama UNION ALL SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc = 0 ORDER BY kode";
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
