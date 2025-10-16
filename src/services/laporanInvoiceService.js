const pool = require("../config/database");

/**
 * Mendapatkan data Laporan Invoice (Per Tanggal, Per Pelanggan, atau Per Level).
 * Disesuaikan dengan logika Delphi (ulapInvoice.pas).
 */
const getInvoiceMasterData = async (filters) => {
  const { startDate, endDate, gudangKode, reportType } = filters;
  const params = [startDate, endDate];
  const isKdc = gudangKode === "ALL";

  let query = "";


  if (reportType === "tanggal") {
    query = `
      SELECT 
        x.inv_tanggal AS Tanggal,
        LEFT(x.inv_nomor, 3) AS Kode,
        SUM(ROUND(x.nominal)) AS Nominal,
        SUM(ROUND(x.hpp)) AS Hpp,
        SUM(ROUND(x.nominal - x.hpp)) AS Laba,
        SUM(x.Donasi) AS Donasi,
        SUM(x.pundiamal) AS PundiAmal
      FROM (
        SELECT 
          h.inv_tanggal,
          h.inv_nomor,
          -- Nominal
          (
            SELECT 
              (SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon))
              - hh.inv_disc
              + (hh.inv_ppn / 100 * 
                (SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) - hh.inv_disc)))
            FROM tinv_dtl dd
            LEFT JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor
            WHERE hh.inv_nomor = h.inv_nomor
          ) AS nominal,

          -- HPP
          (
            SELECT SUM(dd.invd_jumlah * dd.invd_hpp)
            FROM tinv_dtl dd
            LEFT JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor
            WHERE hh.inv_nomor = h.inv_nomor
          ) AS hpp,

          -- Donasi
          IFNULL((
            SELECT COUNT(dd.invd_jumlah) * 500
            FROM tinv_dtl dd
            LEFT JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor
            INNER JOIN tbarangdc a ON a.brg_kode = dd.invd_kode AND a.brg_logstok = 'Y'
            WHERE hh.inv_nomor = h.inv_nomor
          ), 0) AS Donasi,

          -- Pundi Amal
          IFNULL(h.inv_pundiamal, 0) AS pundiamal

        FROM tinv_hdr h
        WHERE h.inv_sts_pro = 0
          AND h.inv_tanggal BETWEEN ? AND ?
          ${!isKdc ? "AND LEFT(h.inv_nomor, 3) = ?" : ""}
      ) AS x
      ${!isKdc ? "GROUP BY x.inv_tanggal, LEFT(x.inv_nomor, 3)" : "GROUP BY x.inv_tanggal"}
      ORDER BY x.inv_tanggal
    `;
    if (!isKdc) params.push(gudangKode);
  }

  else if (reportType === "customer") {
    query = `
      SELECT 
        RIGHT(x.Inv_cus_kode, 5) AS Kode,
        x.Cus_nama AS Nama,
        x.Cus_alamat AS Alamat,
        x.Cus_kota AS Kota,
        x.xLevel,
        x.Level_nama,
        SUM(ROUND(x.nominal)) AS Nominal,
        SUM(ROUND(x.hpp)) AS Hpp,
        SUM(ROUND(x.nominal - x.hpp)) AS Laba,
        SUM(x.Donasi) AS Donasi,
        SUM(x.pundiamal) AS PundiAmal
      FROM (
        SELECT 
          h.inv_nomor,
          h.Inv_cus_kode,
          h.Inv_cus_level AS xLevel,
          c.Cus_nama,
          c.Cus_alamat,
          c.Cus_kota,
          l.level_nama,

          -- Nominal
          (
            SELECT 
              (SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon))
              - hh.inv_disc
              + (hh.inv_ppn / 100 * 
                (SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) - hh.inv_disc)))
            FROM tinv_dtl dd
            LEFT JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor
            WHERE hh.inv_nomor = h.inv_nomor
          ) AS nominal,

          -- HPP
          (
            SELECT SUM(dd.invd_jumlah * dd.invd_hpp)
            FROM tinv_dtl dd
            LEFT JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor
            WHERE hh.inv_nomor = h.inv_nomor
          ) AS hpp,

          -- Donasi
          IFNULL((
            SELECT COUNT(dd.invd_jumlah) * 500
            FROM tinv_dtl dd
            LEFT JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor
            INNER JOIN tbarangdc a ON a.brg_kode = dd.invd_kode AND a.brg_logstok = 'Y'
            WHERE hh.inv_nomor = h.inv_nomor
          ), 0) AS Donasi,

          IFNULL(h.inv_pundiamal, 0) AS pundiamal

        FROM tinv_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.Inv_cus_kode
        LEFT JOIN tcustomer_level l ON l.level_kode = h.inv_cus_level
        WHERE h.inv_sts_pro = 0
          AND h.inv_tanggal BETWEEN ? AND ?
          ${!isKdc ? "AND LEFT(h.inv_nomor, 3) = ?" : ""}
      ) AS x
      GROUP BY x.Inv_cus_kode
      ORDER BY x.Cus_nama
    `;
    if (!isKdc) params.push(gudangKode);
  }


  else if (reportType === "level") {
    query = `
      SELECT 
        l.level_kode AS Kode,
        l.level_nama AS Level,
        IFNULL(z.qty, 0) AS Qty,
        IFNULL(z.nominal, 0) AS Nominal,
        IFNULL(z.hpp, 0) AS Hpp,
        IFNULL(z.nominal - z.hpp, 0) AS Laba,
        IFNULL(z.Donasi, 0) AS Donasi,
        IFNULL(z.pundiamal, 0) AS PundiAmal
      FROM tcustomer_level l
      LEFT JOIN (
        SELECT 
          x.inv_cus_level,
          SUM(x.qty) AS qty,
          SUM(x.nominal) AS nominal,
          SUM(x.hpp) AS hpp,
          SUM(x.donasi) AS Donasi,
          SUM(x.pundiamal) AS pundiamal
        FROM (
          SELECT 
            h.inv_cus_level,
            IFNULL((SELECT SUM(dd.invd_jumlah)
                    FROM tinv_dtl dd
                    WHERE dd.invd_inv_nomor = h.inv_nomor), 0) AS qty,

            IFNULL((SELECT (SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon))
                            - hh.inv_disc
                            + (hh.inv_ppn / 100 *
                              (SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) - hh.inv_disc)))
                    FROM tinv_dtl dd
                    LEFT JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor
                    WHERE hh.inv_nomor = h.inv_nomor), 0) AS nominal,

            IFNULL((SELECT SUM(dd.invd_jumlah * dd.invd_hpp)
                    FROM tinv_dtl dd
                    LEFT JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor
                    WHERE hh.inv_nomor = h.inv_nomor), 0) AS hpp,

            IFNULL((SELECT COUNT(dd.invd_jumlah) * 500
                    FROM tinv_dtl dd
                    LEFT JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor
                    INNER JOIN tbarangdc a ON a.brg_kode = dd.invd_kode AND a.brg_logstok = 'Y'
                    WHERE hh.inv_nomor = h.inv_nomor), 0) AS Donasi,

            IFNULL(h.inv_pundiamal, 0) AS pundiamal
          FROM tinv_hdr h
          WHERE h.inv_tanggal BETWEEN ? AND ?
            ${!isKdc ? "AND LEFT(h.inv_nomor, 3) = ?" : ""}
        ) AS x
        GROUP BY x.inv_cus_level
      ) AS z ON z.inv_cus_level = l.level_kode
      ORDER BY l.level_kode
    `;
    if (!isKdc) params.push(gudangKode);
  }

  if (!query) return [];

  const [rows] = await pool.query(query, params);
  return rows;
};

// ==========================================================
// Detail per Level (drilldown pelanggan)
// ==========================================================
const getDetailCustomerByLevel = async (filters) => {
  const { startDate, endDate, gudangKode, levelKode } = filters;
  const params = [startDate, endDate, levelKode];
  const isKdc = gudangKode === "ALL";

  const query = `
    SELECT
      c.cus_kode AS kdcus,
      c.cus_nama AS nama,
      c.cus_alamat AS alamat,
      c.cus_kota AS kota,
      SUM(d.invd_jumlah) AS Qty,
      SUM(h.inv_nominal) AS Nominal
    FROM tinv_hdr h
    JOIN tcustomer c ON c.cus_kode = h.inv_kdcus
    LEFT JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
    WHERE h.inv_tanggal BETWEEN ? AND ?
      AND c.cus_level = ?
      ${!isKdc ? "AND LEFT(h.inv_nomor, 3) = ?" : ""}
    GROUP BY c.cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota
    ORDER BY c.cus_nama
  `;

  if (!isKdc) params.push(gudangKode);
  const [rows] = await pool.query(query, params);
  return rows;
};

// ==========================================================
// Dropdown Gudang
const getCabangOptions = async (user) => {
    // Pengecekan untuk memastikan objek user dan propertinya ada
    if (!user || !user.cabang) {
        throw new Error("Informasi user atau cabang tidak ditemukan.");
    }

    let query = "";
    let params = [];

    // Menggunakan user.cabangUtama jika ada, jika tidak pakai user.cabang
    const cabangUtama = user.cabangUtama || user.cabang;

    if (cabangUtama === "KDC") {
        // --- DISESUAIKAN DENGAN QUERY DELPHI ---
        query = `
            SELECT 'ALL' AS kode, 'All Cabang' AS nama
            UNION ALL
            SELECT * FROM (
                SELECT gdg_kode AS kode, gdg_nama AS nama 
                FROM retail.tgudang 
                ORDER BY gdg_kode
            ) AS x
        `;
    } else {
        // --- DISESUAIKAN DENGAN QUERY DELPHI ---
        query = `
            SELECT gdg_kode AS kode, gdg_nama AS nama
            FROM retail.tgudang 
            WHERE gdg_kode = ?
        `;
        params.push(cabangUtama);
    }

    try {
        const [rows] = await pool.query(query, params);
        return rows;
    } catch (dbError) {
        console.error("Database error in getCabangOptions:", dbError);
        // Melempar kembali error agar controller bisa mengirim respons 500
        throw dbError;
    }
};

module.exports = {
  getInvoiceMasterData,
  getDetailCustomerByLevel,
  getCabangOptions,
};
