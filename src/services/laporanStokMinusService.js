// src/services/laporanStokMinusService.js

const pool = require("../config/database");

/**
 * Header: Pivot stok minus ke kolom [cite: 2025-09-06]
 */
const getLaporanStokMinus = async (filters) => {
  const { tanggal, cabang } = filters;
  let cabangFilter = "";
  const params = [tanggal];

  if (cabang && cabang !== "KDC" && cabang !== "ALL") {
    cabangFilter = "AND mst_cab = ?";
    params.push(cabang);
  } else if (cabang === "KDC") {
    cabangFilter =
      "AND mst_cab IN (SELECT gdg_kode FROM tgudang WHERE gdg_dc = 1)";
  }

  const query = `
    SELECT 
      s.mst_brg_kode AS KODE,
      TRIM(CONCAT(a.brg_jeniskaos, ' ', a.brg_tipe, ' ', a.brg_lengan, ' ', a.brg_jeniskain, ' ', a.brg_warna)) AS NAMA,
      b.brgd_barcode AS BARCODE,
      a.brg_ktgp AS KATEGORI,
      s.mst_ukuran AS UKURAN,
      s.stok AS QTY
    FROM (
      SELECT mst_brg_kode, mst_ukuran, mst_cab, SUM(mst_stok_in - mst_stok_out) AS stok
      FROM tmasterstok
      WHERE mst_aktif = 'Y' AND mst_tanggal <= ?
      GROUP BY mst_brg_kode, mst_ukuran, mst_cab
      HAVING stok < 0
    ) s
    LEFT JOIN tbarangdc a ON a.brg_kode = s.mst_brg_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = s.mst_brg_kode AND b.brgd_ukuran = s.mst_ukuran
    WHERE a.brg_logstok = 'Y' ${cabangFilter}
    ORDER BY s.mst_brg_kode;
  `;

  const [rows] = await pool.query(query, params);

  // Transformasi data menjadi baris per barang (Pivot JS) [cite: 2025-09-17]
  const pivoted = rows.reduce((acc, cur) => {
    const key = cur.KODE;
    if (!acc[key]) {
      acc[key] = {
        KODE: cur.KODE,
        NAMA: cur.NAMA,
        BARCODE: cur.BARCODE,
        KATEGORI: cur.KATEGORI,
        TOTAL_MINUS: 0,
      };
    }
    acc[key][cur.UKURAN] = cur.QTY;
    acc[key].TOTAL_MINUS += cur.QTY;
    return acc;
  }, {});

  return Object.values(pivoted);
};

/**
 * Detail: Histori mutasi (Hapus mst_nomor_so agar tidak error)
 */
/**
 * Detail: Histori mutasi (Penambahan deskripsi transaksi berdasarkan prefix)
 */
const getDetailStokMinus = async (kode, cabang, tanggal) => {
  const query = `
    SELECT 
        t.mst_ukuran AS ukuran,
        t.mst_tanggal AS tanggal,
        t.mst_noreferensi AS referensi,
        IFNULL((SELECT mst_nomor_so FROM tmasterstokso s WHERE s.mst_idrec = t.mst_idrec LIMIT 1), '-') AS no_pesanan,
        t.mst_stok_in AS masuk,
        t.mst_stok_out AS keluar,
        /* [FIX] Pemetaan Jenis Transaksi berdasarkan prefix nomor referensi */
        CASE 
            WHEN t.mst_noreferensi = 'STOK AWAL' THEN 'Stok Awal'
            WHEN t.mst_noreferensi LIKE '%SJ%' THEN 'Surat Jalan'
            WHEN t.mst_noreferensi LIKE '%INV%' THEN 'Invoice'
            WHEN t.mst_noreferensi LIKE '%TS%' THEN 'Terima STBJ'
            WHEN t.mst_noreferensi LIKE '%TJ%' THEN 'Terima SJ'
            WHEN t.mst_noreferensi LIKE '%RB%' THEN 'Retur Barang'
            WHEN t.mst_noreferensi LIKE '%RJ%' THEN 'Retur Jual'
            WHEN t.mst_noreferensi LIKE '%PJ%' THEN 'Peminjaman Barang'
            WHEN t.mst_noreferensi LIKE '%PK%' THEN 'Pengembalian Barang'
            WHEN t.mst_noreferensi LIKE '%MSO%' THEN 'Mutasi Stok ke Pesanan'
            WHEN t.mst_noreferensi LIKE '%SOP%' THEN 'Selisih SOP'
            WHEN t.mst_noreferensi LIKE '%QC%' THEN 'QC ke Garmen'
            WHEN t.mst_noreferensi LIKE '%MUT%' THEN 'Mutasi Antar Gudang'
            WHEN t.mst_noreferensi LIKE '%MSI%' THEN 'Mutasi Stok dari Pesanan'
            WHEN t.mst_noreferensi LIKE '%MST%' THEN 'Mutasi Store Terima'
            WHEN t.mst_noreferensi LIKE '%MSK%' THEN 'Mutasi Store Kirim'
            ELSE t.mst_ket
        END AS transaksi,
        (SELECT SUM(x.mst_stok_in - x.mst_stok_out) 
         FROM tmasterstok x 
         WHERE x.mst_brg_kode = t.mst_brg_kode AND x.mst_ukuran = t.mst_ukuran 
           AND x.mst_cab = t.mst_cab AND x.mst_aktif = 'Y' 
           AND (x.mst_tanggal < t.mst_tanggal OR (x.mst_tanggal = t.mst_tanggal AND x.date_create <= t.date_create))
        ) AS saldo
    FROM tmasterstok t
    WHERE t.mst_brg_kode = ? AND t.mst_cab = ? AND t.mst_aktif = 'Y' AND t.mst_tanggal <= ?
    AND t.mst_ukuran IN (
        SELECT mst_ukuran FROM tmasterstok WHERE mst_brg_kode = ? AND mst_cab = ? AND mst_aktif = 'Y' AND mst_tanggal <= ?
        GROUP BY mst_ukuran HAVING SUM(mst_stok_in - mst_stok_out) < 0
    )
    ORDER BY t.mst_ukuran, t.mst_tanggal ASC, t.date_create ASC;
  `;
  const [rows] = await pool.query(query, [
    kode,
    cabang,
    tanggal,
    kode,
    cabang,
    tanggal,
  ]);
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
  getDetailStokMinus,
  getCabangOptions,
};
