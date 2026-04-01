const pool = require("../config/database");
const { eachDayOfInterval, format } = require("date-fns");

// Mengambil daftar cabang untuk filter
const getCabangList = async (user) => {
  let query;
  if (user.cabang === "KDC") {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc = 0 ORDER BY gdg_kode";
  } else {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?";
  }
  const [rows] = await pool.query(query, [user.cabang]);
  return rows;
};

// Mengambil data utama dasbor (Master Grid per Tanggal Pengerjaan)
const getDasborData = async (filters) => {
  const { startDate, endDate, cabang } = filters;
  if (!startDate || !endDate || !cabang) return [];

  // --- AMBIL TOTAL SO, KAOS, DAN KUOTA DARI TABEL BORDIR ---
  // Menggunakan MAX(b.kuota) karena kuota tersimpan di tiap baris SO.
  // Kita ambil nilai kuota tertinggi yang diset pada hari tersebut.
  const totalsQuery = `
        SELECT 
            DATE_FORMAT(b.tgl_pengerjaan, '%Y-%m-%d') AS tgl,
            MAX(IFNULL(b.kuota, 30)) AS KuotaHarian,
            COUNT(h.sd_nomor) AS TotalSO,
            SUM(IFNULL((SELECT SUM(d.sdd_jumlah) FROM tsodtf_dtl d WHERE d.sdd_nomor = h.sd_nomor), 0)) AS TotalKaos
        FROM tsodtf_hdr h
        JOIN tdashboard_bordir b ON h.sd_nomor = b.so_nomor
        WHERE h.sd_nomor LIKE '%.BR.%' 
          AND h.sd_cab = ?
          AND b.tgl_pengerjaan BETWEEN ? AND ?
        GROUP BY tgl
    `;

  const [totalRows] = await pool.query(totalsQuery, [
    cabang,
    startDate,
    endDate,
  ]);

  // Mapping hasil query ke dalam Map agar mudah dicocokkan dengan tanggal
  const totalsMap = new Map(
    totalRows.map((row) => [
      row.tgl,
      {
        kuota: row.KuotaHarian,
        so: row.TotalSO,
        kaos: row.TotalKaos,
      },
    ]),
  );

  // Buat rentang tanggal agar tanggal yang tidak ada antrian tetap muncul di tabel
  const dateRange = eachDayOfInterval({
    start: new Date(startDate),
    end: new Date(endDate),
  });

  const result = dateRange.map((date) => {
    const tglStr = format(date, "yyyy-MM-dd");
    const data = totalsMap.get(tglStr) || null;

    // Logika Kuota:
    // 1. Ambil dari DB jika ada (data.kuota)
    // 2. Jika tidak ada di DB, cek apakah cabang K06. Jika ya, set 30. Jika bukan, set 0.
    const kuotaAktif = data ? data.kuota : cabang === "K06" ? 30 : 0;
    const totalSoAktif = data ? data.so : 0;
    const totalKaosAktif = data ? data.kaos : 0;

    return {
      TglPengerjaan: tglStr,
      Kuota: kuotaAktif,
      TotalSO: totalSoAktif,
      TotalKaos: totalKaosAktif,
      Sisa: kuotaAktif - totalKaosAktif, // Sisa = Kuota Harian - Jumlah Kaos
    };
  });

  return result;
};

// Mengambil data detail untuk satu tanggal (Rincian per SO)
const getDasborDetail = async (filters) => {
  const { tanggal, cabang } = filters;

  const query = `
        SELECT 
            h.sd_nomor AS SoBordir,
            DATE_FORMAT(b.tgl_pengerjaan, '%d-%m-%Y') AS TglPengerjaan,
            h.sd_nama AS Nama,
            IFNULL((SELECT SUM(d.sdd_jumlah) FROM tsodtf_dtl d WHERE d.sdd_nomor = h.sd_nomor), 0) AS JumlahKaos,
            b.alasan_pending AS Alasan,
            -- LOGIKA STATUS: Jika sudah ada di tabel tdtf (LHK), otomatis Ready. Jika tidak, ikuti status inputan.
            CASE 
                WHEN EXISTS (SELECT 1 FROM tdtf WHERE sodtf = h.sd_nomor) THEN 'Ready'
                ELSE IFNULL(b.status, 'Antri') 
            END AS Status
        FROM tsodtf_hdr h
        JOIN tdashboard_bordir b ON h.sd_nomor = b.so_nomor
        WHERE h.sd_nomor LIKE '%.BR.%' 
          AND h.sd_cab = ?
          AND b.tgl_pengerjaan = ?
        ORDER BY h.sd_nomor
    `;
  const [rows] = await pool.query(query, [cabang, tanggal]);
  return rows;
};

// Fungsi untuk ekspor
const exportHeader = getDasborData;
const exportDetail = async (filters) => {
  const { startDate, endDate, cabang } = filters;
  const query = `
        SELECT 
            DATE_FORMAT(b.tgl_pengerjaan, '%d-%m-%Y') AS TglPengerjaan,
            h.sd_nomor AS SoBordir,
            h.sd_nama AS Nama,
            IFNULL((SELECT SUM(d.sdd_jumlah) FROM tsodtf_dtl d WHERE d.sdd_nomor = h.sd_nomor), 0) AS JumlahKaos,
            CASE 
                WHEN EXISTS (SELECT 1 FROM tdtf WHERE sodtf = h.sd_nomor) THEN 'Ready'
                ELSE IFNULL(b.status, 'Antri') 
            END AS Status,
            b.alasan_pending AS AlasanPending
        FROM tsodtf_hdr h
        JOIN tdashboard_bordir b ON h.sd_nomor = b.so_nomor
        WHERE h.sd_nomor LIKE '%.BR.%' 
          AND h.sd_cab = ?
          AND b.tgl_pengerjaan BETWEEN ? AND ?
        ORDER BY b.tgl_pengerjaan, h.sd_nomor
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
