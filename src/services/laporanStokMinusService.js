// src/services/laporanStokMinusService.js

const pool = require("../config/database");

/**
 * @description Mengambil laporan stok minus berdasarkan filter.
 */
const getLaporanStokMinus = async (filters) => {
  const { tanggal, cabang } = filters;

  let cabangFilter = "";
  const params = [tanggal];

  if (cabang && cabang !== "KDC") {
    cabangFilter = "AND mst_cab = ?";
    params.push(cabang);
  } else if (cabang === "KDC") {
    cabangFilter =
      "AND mst_cab IN (SELECT gdg_kode FROM tgudang WHERE gdg_dc = 1)";
  }

  const query = `
    SELECT
        s.mst_brg_kode AS kode,
        b.brgd_barcode AS barcode,
        a.brg_ktgp AS kategori,
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
        s.mst_ukuran AS ukuran,
        s.stok,
        s.mst_cab AS cabang_kode,
        g.gdg_nama AS cabang_nama,
        /* [TAMBAHAN] Mencari referensi transaksi keluar terakhir yang menyebabkan minus */
        (
          SELECT mst_noreferensi 
          FROM tmasterstok 
          WHERE mst_brg_kode = s.mst_brg_kode 
            AND mst_ukuran = s.mst_ukuran 
            AND mst_cab = s.mst_cab 
            AND mst_stok_out > 0 
            AND mst_aktif = 'Y'
            AND mst_tanggal <= ?
          ORDER BY mst_tanggal DESC, date_create DESC 
          LIMIT 1
        ) AS referensi
    FROM (
        SELECT 
            mst_brg_kode, 
            mst_ukuran, 
            mst_cab,
            SUM(mst_stok_in - mst_stok_out) AS stok
        FROM tmasterstok
        WHERE mst_aktif = 'Y'
          AND mst_tanggal <= ?
          ${cabangFilter}
        GROUP BY mst_brg_kode, mst_ukuran, mst_cab
        HAVING stok < 0
    ) s
    LEFT JOIN tbarangdc a ON a.brg_kode = s.mst_brg_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = s.mst_brg_kode AND b.brgd_ukuran = s.mst_ukuran
    LEFT JOIN tgudang g ON g.gdg_kode = s.mst_cab
    WHERE a.brg_logstok = 'Y'
    ORDER BY s.stok ASC;
  `;

  // Tambahkan parameter tanggal untuk subquery referensi di paling depan
  const [rows] = await pool.query(query, [tanggal, ...params]);
  return rows;
};

const getCabangOptions = async (user) => {
  let query = "";
  let params = [];

  if (user.cabang === "KDC") {
    // 1. Jika user KDC: Ambil 'SEMUA' dan semua gudang
    query = "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang";
    // params tetap kosong
  } else {
    // 2. Jika user BUKAN KDC: Ambil HANYA cabang user DAN 'KDC'
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ? OR gdg_kode = 'KDC'";
    params.push(user.cabang);
  }

  const [rows] = await pool.query(query, params);

  // 3. Tambahkan opsi "SEMUA" hanya jika user KDC
  if (user.cabang === "KDC") {
    rows.unshift({ kode: "KDC", nama: "SEMUA CABANG DC" });
  }

  return rows;
};

module.exports = {
  getLaporanStokMinus,
  getCabangOptions,
};
