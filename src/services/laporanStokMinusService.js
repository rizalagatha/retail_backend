// src/services/laporanStokMinusService.js

const pool = require("../config/database");

/**
 * @description Mengambil laporan stok minus berdasarkan filter.
 */
const getLaporanStokMinus = async (filters) => {
  const { tanggal, cabang } = filters;
  
  let cabangFilter = "";
  const params = [tanggal]; // Parameter pertama selalu tanggal

  // [PERBAIKAN] Logika filter cabang diubah
  if (cabang && cabang !== 'KDC') {
    // Jika user memilih cabang spesifik
    cabangFilter = "AND mst_cab = ?";
    params.push(cabang);
  } else if (cabang === 'KDC') {
    // Jika user KDC memilih 'SEMUA CABANG DC'
    cabangFilter = "AND mst_cab IN (SELECT gdg_kode FROM tgudang WHERE gdg_dc = 1)";
    // Tidak perlu menambah parameter
  }
  // Jika user BUKAN KDC dan filternya adalah cabang KDC,
  // query akan tetap berjalan sesuai parameter (misal 'K01')

  const query = `
    SELECT
        s.mst_brg_kode AS kode,
        b.brgd_barcode AS barcode,
        a.brg_ktgp AS kategori,
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
        s.mst_ukuran AS ukuran,
        s.stok,
        s.mst_cab AS cabang_kode,  -- [TAMBAHAN 1]
        g.gdg_nama AS cabang_nama   -- [TAMBAHAN 2]
    FROM (
        SELECT 
            mst_brg_kode, 
            mst_ukuran, 
            mst_cab,
            SUM(mst_stok_in - mst_stok_out) AS stok
        FROM tmasterstok
        WHERE mst_aktif = 'Y'
          AND mst_tanggal <= ?  -- Filter tanggal (parameter ke-1)
          ${cabangFilter}       -- Filter cabang (parameter ke-2, opsional)
        GROUP BY mst_brg_kode, mst_ukuran, mst_cab
        HAVING stok < 0
    ) s
    LEFT JOIN tbarangdc a ON a.brg_kode = s.mst_brg_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = s.mst_brg_kode AND b.brgd_ukuran = s.mst_ukuran
    LEFT JOIN tgudang g ON g.gdg_kode = s.mst_cab -- [TAMBAHAN 3: JOIN ke tgudang]
    WHERE a.brg_logstok = 'Y'
    ORDER BY s.stok ASC;
  `;

  const [rows] = await pool.query(query, params);
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
