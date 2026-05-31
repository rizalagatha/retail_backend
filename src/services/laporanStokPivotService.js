const pool = require("../config/database");

/**
 * Mengambil data mentah stok untuk laporan pivot.
 * Menerjemahkan TfrmLapStok.btnTampilClick
 */
const getList = async (filters, user) => {
  const { cabang, tampilkanKosong } = filters;

  let params = [];
  let whereClauses = [`a.brg_logstok = "Y"`];

  // [FIX] Gunakan x.Cabang bukan m.mst_cab (m sudah tidak ada di scope outer query)
  if (user.cabang !== "KDC") {
    whereClauses.push("x.Cabang = ?");
    params.push(user.cabang);
  } else if (cabang && cabang !== "ALL") {
    whereClauses.push("x.Cabang = ?");
    params.push(cabang);
  }

  const query = `
    SELECT 
        x.Cabang, x.Kode,
        TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS Nama,
        x.Ukuran, x.Stok
    FROM (
        SELECT 
            m.mst_cab AS Cabang, m.mst_brg_kode AS Kode, m.mst_ukuran AS Ukuran, 
            SUM(m.mst_stok_in - m.mst_stok_out) AS Stok
        FROM tmasterstok m
        WHERE m.mst_aktif = "Y"
        GROUP BY m.mst_cab, m.mst_brg_kode, m.mst_ukuran
    ) x
    LEFT JOIN tbarangdc a ON a.brg_kode = x.Kode
    WHERE 
        ${whereClauses.join(" AND ")}
        ${!tampilkanKosong ? "AND x.Stok <> 0" : ""}
    ORDER BY x.Cabang, x.Kode, x.Ukuran;
  `;

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil data yang sudah diagregasi untuk grafik.
 */
const getChartData = async (filters, user) => {
  const { cabang, tampilkanKosong } = filters;

  let params = [];
  let whereClauses = [`a.brg_logstok="Y"`];

  if (user.cabang !== "KDC") {
    whereClauses.push("x.Cabang = ?");
    params.push(user.cabang);
  } else if (cabang && cabang !== "ALL") {
    whereClauses.push("x.Cabang = ?");
    params.push(cabang);
  }

  const query = `
        SELECT 
            x.Cabang,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe)) AS NamaGrup, -- Grup berdasarkan nama
            SUM(x.Stok) AS TotalStok
        FROM (
            SELECT 
                m.mst_cab AS Cabang, m.mst_brg_kode AS Kode, 
                SUM(m.mst_stok_in - m.mst_stok_out) AS Stok
            FROM tmasterstok m
            WHERE m.mst_aktif = "Y"
            GROUP BY m.mst_cab, m.mst_brg_kode
        ) X
        LEFT JOIN tbarangdc a ON a.brg_kode = x.kode
        WHERE 
            ${whereClauses.join(" AND ")}
            ${!tampilkanKosong ? "AND x.Stok <> 0" : ""}
        GROUP BY x.Cabang, NamaGrup
        ORDER BY x.Cabang, TotalStok DESC;
    `;

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil opsi cabang untuk filter.
 */
const getCabangOptions = async (user) => {
  let query;
  const params = [];
  if (user.cabang === "KDC") {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang UNION ALL SELECT 'ALL' AS kode, 'ALL STORE' AS nama ORDER BY kode";
  } else {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?";
    params.push(user.cabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

const getAggregated = async (filters, user) => {
  const { cabang, tampilkanKosong } = filters;

  let params = [];
  let whereClauses = [`a.brg_logstok = "Y"`];

  if (user.cabang !== "KDC") {
    whereClauses.push("x.Cabang = ?");
    params.push(user.cabang);
  } else if (cabang && cabang !== "ALL") {
    whereClauses.push("x.Cabang = ?");
    params.push(cabang);
  }

  // [FIX] Hapus GROUP BY di subquery, biarkan outer query yang agregasi
  // Subquery hanya filter mst_aktif, outer query yang SUM dan GROUP
  const query = `
    SELECT 
        m.mst_cab AS Cabang,
        TRIM(CONCAT(
          a.brg_jeniskaos, " ", a.brg_tipe, " ",
          a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna
        )) AS Nama,
        m.mst_ukuran AS Ukuran,
        SUM(m.mst_stok_in - m.mst_stok_out) AS Stok
    FROM tmasterstok m
    LEFT JOIN tbarangdc a ON a.brg_kode = m.mst_brg_kode
    WHERE m.mst_aktif = "Y"
      AND a.brg_logstok = "Y"
      ${user.cabang !== "KDC" ? `AND m.mst_cab = ?` : cabang && cabang !== "ALL" ? `AND m.mst_cab = ?` : ""}
    GROUP BY m.mst_cab, m.mst_brg_kode, Nama, m.mst_ukuran
    HAVING ${!tampilkanKosong ? "Stok <> 0" : "1=1"}
    ORDER BY Nama, m.mst_ukuran, m.mst_cab;
  `;

  // Rebuild params untuk query flat (bukan nested)
  const flatParams = [];
  if (user.cabang !== "KDC") {
    flatParams.push(user.cabang);
  } else if (cabang && cabang !== "ALL") {
    flatParams.push(cabang);
  }

  const [rows] = await pool.query(query, flatParams);
  return rows;
};

module.exports = {
  getList,
  getChartData,
  getCabangOptions,
  getAggregated,
};
