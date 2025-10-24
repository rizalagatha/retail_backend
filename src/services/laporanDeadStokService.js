const pool = require("../config/database");

/**
 * Mengambil data Laporan Dead Stock dengan filter.
 */
const getList = async (filters, user) => {
  const { cabang, minUmur } = filters;

  let branchFilter = "";
  const params = [minUmur];

  if (user.cabang !== "KDC") {
    branchFilter = `AND m.mst_cab = ?`;
    params.push(user.cabang);
  } else if (cabang !== "ALL") {
    branchFilter = `AND m.mst_cab = ?`;
    params.push(cabang);
  }

  // Query ini sekarang jauh lebih sederhana dan memiliki filter
  const query = `
        SELECT 
            a.cabang, c.gdg_nama AS 'Nama Cabang',
            brg_ktgp AS 'KtgProduk', brg_ktg AS 'KtgBarang',
            a.kode AS 'Kode Barang', a.nama AS 'Nama Barang', a.ukuran AS 'Ukuran', a.stok AS 'Stok', 
            b.last_tstbj AS 'Last Terima STBJ/Tanggal', b.last_nomor_tstbj AS 'No STBJ/SJ',
            DATEDIFF(CURDATE(), b.last_tstbj) AS 'Umur (Hari)',
            FLOOR(DATEDIFF(CURDATE(), b.last_tstbj) / 30) AS 'Umur (Bulan)',
            FLOOR(DATEDIFF(CURDATE(), b.last_tstbj) / 360) AS 'Umur (Tahun)'
        FROM (
            -- 1. Ambil Stok Aktif
            SELECT 
                x.Cabang, x.Kode,
                brg_ktgp, brg_ktg,
                TRIM(CONCAT(a.brg_jeniskaos, ' ', a.brg_tipe, ' ', a.brg_lengan, ' ', a.brg_jeniskain, ' ', a.brg_warna)) AS Nama,
                x.Ukuran, x.Stok
            FROM (
                SELECT 
                    m.mst_cab AS Cabang, m.mst_brg_kode AS Kode, m.mst_ukuran AS Ukuran,
                    SUM(m.mst_stok_in - m.mst_stok_out) AS Stok
                FROM tmasterstok m
                WHERE m.mst_aktif = 'Y' ${branchFilter}
                GROUP BY m.mst_cab, m.mst_brg_kode, m.mst_ukuran
            ) X
            LEFT JOIN tbarangdc a ON a.brg_kode = x.kode
            WHERE x.stok <> 0 AND a.brg_logstok = 'Y'
        ) a
        LEFT JOIN (
            -- 2. Ambil Tanggal Terima Terakhir (STBJ/SJ)
            SELECT 
                LEFT(tjd_nomor, 3) AS cabang, tjd_kode, tjd_ukuran, 
                MAX(tj_tanggal) AS last_tstbj, MAX(tj_nomor) AS last_nomor_tstbj
            FROM ttrm_sj_hdr
            INNER JOIN ttrm_sj_dtl ON tjd_nomor = tj_nomor
            GROUP BY 1, 2, 3
        ) b ON (b.cabang = a.cabang AND b.tjd_kode = a.kode AND b.tjd_ukuran = a.ukuran)
        LEFT JOIN tgudang c ON (c.gdg_kode = a.cabang)
        -- 3. Terapkan Filter Umur
        HAVING DATEDIFF(CURDATE(), b.last_tstbj) >= ?
        ORDER BY \`Umur (Hari)\` DESC, a.cabang, a.nama;
    `;

  const [rows] = await pool.query(query, params);
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
