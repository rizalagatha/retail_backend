const pool = require("../config/database");

const getList = async (filters, user) => {
  const { startDate, endDate, hargaNol, hppNol } = filters;

  // Query Master dari Delphi
  let query = `
        SELECT x.kode, x.kategori, x.nama, x.date_create, x.otomatis, x.adaStok, x.status
        FROM (
            SELECT 
                a.brg_kode AS kode,
                TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
                a.brg_ktgp AS kategori,
                a.date_create,
                IF(a.brg_otomatis=1, "YA", "") AS otomatis,
                a.brg_logstok AS adaStok,
                IF(a.brg_aktif=0, "AKTIF", "PASIF") AS status,
                (SELECT SUM(b.brgd_harga) FROM tbarangdc_dtl b WHERE b.brgd_kode = a.brg_kode) AS harga,
                (SELECT SUM(b.brgd_hpp) FROM tbarangdc_dtl b WHERE b.brgd_kode = a.brg_kode) AS hpp
            FROM tbarangdc a
            WHERE a.brg_ktg = "" AND a.date_create BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
        ) x
    `;

  // Terapkan filter checkbox
  const whereConditions = [];
  if (hargaNol === "true" || hargaNol === true) {
    whereConditions.push("x.harga = 0");
  }
  if (hppNol === "true" || hppNol === true) {
    whereConditions.push("x.hpp <= 50");
  }

  if (whereConditions.length > 0) {
    query += ` WHERE ${whereConditions.join(" AND ")}`;
  }

  query += " ORDER BY x.nama";

  const [rows] = await pool.query(query, [startDate, endDate]);
  return rows;
};

const getDetails = async (kode, user) => {
  // Query Detail dari Delphi
  let selectHpp = user.cabang === "KDC" ? "b.brgd_hpp AS hpp," : "";

  const query = `
        SELECT 
            b.brgd_kode AS kode,
            b.brgd_ukuran AS ukuran,
            b.brgd_barcode AS barcode,
            ${selectHpp}
            b.brgd_harga AS hargaJual,
            b.brgd_spk_tanggal AS tglSpk,
            b.brgd_produksi AS tglProduksi,
            b.brgd_min AS minBufferStore,
            b.brgd_max AS maxBufferStore,
            b.brgd_mindc AS minBufferDC,
            b.brgd_maxdc AS maxBufferDC
        FROM tbarangdc_dtl b
        LEFT JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
        LEFT JOIN tukuran u ON u.ukuran = b.brgd_ukuran AND u.kategori = ""
        WHERE b.brgd_kode = ?
        ORDER BY u.kode;
    `;
  const [rows] = await pool.query(query, [kode]);
  return rows;
};

const getExportDetails = async (filters) => {
  const { startDate, endDate, hargaNol, hppNol } = filters;

  let baseQuery = `
        SELECT 
            a.brg_kode AS 'Kode Barang',
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS 'Nama Barang',
            b.brgd_ukuran AS 'Ukuran',
            b.brgd_barcode AS 'Barcode',
            b.brgd_hpp AS 'HPP',
            b.brgd_harga AS 'Harga Jual',
            IF(a.brg_aktif=0, "AKTIF", "PASIF") AS 'Status'
        FROM tbarangdc a
        INNER JOIN tbarangdc_dtl b ON a.brg_kode = b.brgd_kode
        WHERE a.brg_ktg = "" AND a.date_create BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
    `;

  const whereConditions = [];
  if (hargaNol === "true" || hargaNol === true) {
    whereConditions.push("b.brgd_harga = 0");
  }
  if (hppNol === "true" || hppNol === true) {
    whereConditions.push("b.brgd_hpp <= 50");
  }

  if (whereConditions.length > 0) {
    baseQuery += ` AND ${whereConditions.join(" AND ")}`;
  }

  baseQuery += " ORDER BY a.brg_kode, b.brgd_ukuran";

  const [rows] = await pool.query(baseQuery, [startDate, endDate]);
  return rows;
};

const getTotalProducts = async () => {
  // Query ini sekarang menghitung total, total aktif, dan total pasif
  const query = `
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN brg_aktif = 0 THEN 1 ELSE 0 END) as totalAktif,
            SUM(CASE WHEN brg_aktif <> 0 THEN 1 ELSE 0 END) as totalPasif
        FROM tbarangdc 
        WHERE brg_ktg = ''
    `;
  const [rows] = await pool.query(query);
  // Kembalikan seluruh objek hasil, bukan hanya total
  return rows[0];
};

module.exports = { getList, getDetails, getExportDetails, getTotalProducts };
