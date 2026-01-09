const pool = require("../config/database");
const { eachDayOfInterval, format } = require("date-fns");

// Mengambil daftar cabang untuk filter
const getCabangList = async (user) => {
  let query;
  if (user.cabang === "KDC") {
    // Query ini sudah benar sesuai Delphi: hanya ambil cabang (bukan DC)
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc = 0 ORDER BY gdg_kode";
  } else {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?";
  }
  const [rows] = await pool.query(query, [user.cabang]);
  return rows;
};

// Mengambil data utama dasbor (master grid)
const getDasborData = async (filters) => {
  const { startDate, endDate, cabang } = filters;
  if (!startDate || !endDate || !cabang) return [];

  // 1. Ambil kuota untuk cabang yang dipilih
  const [kuotaRows] = await pool.query(
    "SELECT dq_kuota FROM tdtf_kuota WHERE dq_cab = ?",
    [cabang]
  );
  const kuota = kuotaRows.length > 0 ? kuotaRows[0].dq_kuota : 0;

  // 2. Ambil total titik yang sudah terpakai per tanggal
  const totalsQuery = `
        SELECT 
            DATE_FORMAT(h.sd_datekerja, '%Y-%m-%d') AS tgl,
            SUM(
                IFNULL((SELECT SUM(d.sdd_jumlah) FROM tsodtf_dtl d WHERE d.sdd_nomor = h.sd_nomor), 0) * IFNULL((SELECT COUNT(*) FROM tsodtf_dtl2 i WHERE i.sdd2_nomor = h.sd_nomor), 0)
            ) AS totalTitik
        FROM tsodtf_hdr h
        WHERE h.sd_jo_kode = "SD" 
          AND h.sd_cab = ?
          AND h.sd_datekerja BETWEEN ? AND ?
        GROUP BY tgl
    `;
  const [totalRows] = await pool.query(totalsQuery, [
    cabang,
    startDate,
    endDate,
  ]);
  const totalsMap = new Map(totalRows.map((row) => [row.tgl, row.totalTitik]));

  // 3. Buat daftar tanggal sesuai rentang filter
  const dateRange = eachDayOfInterval({
    start: new Date(startDate),
    end: new Date(endDate),
  });

  // 4. Gabungkan data
  const result = dateRange.map((date) => {
    const tglStr = format(date, "yyyy-MM-dd");
    const totalTitik = totalsMap.get(tglStr) || 0;
    return {
      TglPengerjaan: tglStr,
      Kuota: kuota,
      TotalTitik: totalTitik,
      Sisa: kuota - totalTitik,
    };
  });

  return result;
};

// Mengambil data detail untuk satu tanggal
// Ganti fungsi getDasborDetail yang lama dengan yang ini

const getDasborDetail = async (filters) => {
  const { tanggal, cabang } = filters; // `tanggal` di sini formatnya 'YYYY-MM-DD'

  // Membuat rentang waktu untuk satu hari penuh
  const startDate = `${tanggal} 00:00:00`;
  const endDate = `${tanggal} 23:59:59`;

  // Query ini menggunakan BETWEEN untuk perbandingan DATETIME yang lebih akurat
  const query = `
        SELECT 
            h.sd_nomor AS SoDTF,
            DATE_FORMAT(h.sd_datekerja, '%d-%m-%Y') AS TglPengerjaan,
            h.sd_nama AS Nama,
            IFNULL((SELECT SUM(d.sdd_jumlah) FROM tsodtf_dtl d WHERE d.sdd_nomor = h.sd_nomor), 0) AS Jumlah,
            IFNULL((SELECT COUNT(*) FROM tsodtf_dtl2 i WHERE i.sdd2_nomor = h.sd_nomor), 0) AS Titik,
            (
                IFNULL((SELECT SUM(d.sdd_jumlah) FROM tsodtf_dtl d WHERE d.sdd_nomor = h.sd_nomor), 0) *
                IFNULL((SELECT COUNT(*) FROM tsodtf_dtl2 i WHERE i.sdd2_nomor = h.sd_nomor), 0)
            ) AS TotalTitik
        FROM tsodtf_hdr h
        WHERE h.sd_jo_kode = "SD" 
          AND h.sd_cab = ?
          AND h.sd_datekerja BETWEEN ? AND ?
        ORDER BY h.sd_nomor
    `;
  const [rows] = await pool.query(query, [cabang, startDate, endDate]);
  return rows;
};

// Fungsi untuk ekspor
const exportHeader = getDasborData; // Logikanya sama dengan getDasborData
const exportDetail = async (filters) => {
  // Untuk export detail, kita ambil semua detail dalam rentang tanggal
  const { startDate, endDate, cabang } = filters;
  const query = `
    SELECT 
        DATE_FORMAT(h.sd_datekerja, '%d-%m-%Y') as TglPengerjaan,
        h.sd_nomor AS SoDTF,
        h.sd_nama AS Nama,
        IFNULL((SELECT SUM(d.sdd_jumlah) FROM tsodtf_dtl d WHERE d.sdd_nomor = h.sd_nomor), 0) AS Jumlah,
        IFNULL((SELECT COUNT(*) FROM tsodtf_dtl2 i WHERE i.sdd2_nomor = h.sd_nomor), 0) AS Titik,
        (
            IFNULL((SELECT SUM(d.sdd_jumlah) FROM tsodtf_dtl d WHERE d.sdd_nomor = h.sd_nomor), 0) *
            IFNULL((SELECT COUNT(*) FROM tsodtf_dtl2 i WHERE i.sdd2_nomor = h.sd_nomor), 0)
        ) AS TotalTitik
    FROM tsodtf_hdr h
    WHERE h.sd_jo_kode = "SD" 
        AND h.sd_cab = ?
        AND h.sd_datekerja BETWEEN ? AND ?
    ORDER BY h.sd_datekerja, h.sd_nomor
    `;
  const [rows] = await pool.query(query, [cabang, startDate, endDate]);
  return rows;
};

module.exports = {
  getCabangList,
  getDasborData,
  getDasborDetail,
  exportHeader,
  exportDetail,
};
