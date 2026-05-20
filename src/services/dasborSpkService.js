const pool = require("../config/database");
const { eachDayOfInterval, format, subDays } = require("date-fns");

const getCabangList = async (user) => {
  let query;
  if (user.cabang === "KDC") {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc = 0 ORDER BY gdg_kode";
  } else {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?";
  }
  const [rows] = await pool.query(
    query,
    user.cabang === "KDC" ? [] : [user.cabang],
  );
  return rows;
};

const getKuota = async () => {
  // Ambil kuota global dengan kode 'ALL'
  const [rows] = await pool.query(
    "SELECT dsc_kuota FROM tdashboard_spk_config WHERE dsc_cab = 'ALL'",
  );
  return rows.length > 0 ? rows[0].dsc_kuota : 150;
};

const saveKuota = async (kuota, user) => {
  await pool.query(
    `INSERT INTO tdashboard_spk_config (dsc_cab, dsc_kuota, date_modified, user_modified)
     VALUES ('ALL', ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       dsc_kuota = VALUES(dsc_kuota),
       date_modified = NOW(),
       user_modified = VALUES(user_modified)`,
    [kuota, user.kode],
  );
  return { message: "Kuota Global berhasil disimpan." };
};

const getDasborData = async (filters) => {
  const { startDate, endDate } = filters;
  if (!startDate || !endDate) return [];

  const kuota = await getKuota();

  const totalsQuery = `
    SELECT
      DATE_FORMAT(h.spk_dateline, '%Y-%m-%d') AS tgl,
      COUNT(*) AS totalSpk,
      SUM(h.spk_jumlah) AS totalJumlah
    FROM kencanaprint.tspk h
    LEFT JOIN tuser u ON u.user_kode = h.user_create
      AND u.user_cab NOT IN ('K04', 'B02')
    WHERE h.spk_divisi = 3
      AND h.spk_aktif = 'Y'
      AND h.spk_close = 0
      AND TRIM(IFNULL(h.spk_cmo, '')) <> ''
      AND h.spk_dateline IS NOT NULL
      AND h.user_create NOT IN ('ADIN', 'LUTFI')
      AND DATE(h.spk_dateline) BETWEEN ? AND ?
    GROUP BY tgl
  `;
  const [totalRows] = await pool.query(totalsQuery, [startDate, endDate]);
  const totalsMap = new Map(totalRows.map((r) => [r.tgl, r]));

  const dateRange = eachDayOfInterval({
    start: new Date(startDate),
    end: new Date(endDate),
  });

  return dateRange.map((date) => {
    const tglStr = format(date, "yyyy-MM-dd");
    const data = totalsMap.get(tglStr);
    return {
      TglSPK: tglStr,
      Kuota: kuota,
      TotalSPK: data ? Number(data.totalSpk) : 0,
      TotalJumlah: data ? Number(data.totalJumlah) : 0,
      Sisa: kuota - (data ? Number(data.totalJumlah) : 0),
    };
  });
};

const getDasborDetail = async (filters) => {
  const { tanggal } = filters;
  if (!tanggal) return [];

  const query = `
    SELECT
      h.spk_nomor AS NomorSPK,
      DATE_FORMAT(h.spk_tanggal, '%d-%m-%Y') AS TglSPK,
      h.spk_nama AS NamaDesain,
      h.spk_jumlah AS Jumlah,
      h.spk_kain AS Kain,
      h.spk_ukuran AS Ukuran,
      h.user_create AS UserCreate,
      DATE_FORMAT(h.spk_dateline, '%d-%m-%Y') AS Dateline,
      TRIM(IFNULL(h.spk_cmo, '')) AS CMO,
      h.spk_pending AS StatusPending,
      h.spk_statuskerja AS StatusKerja,
      h.spk_ketpending AS KetPending,
      h.spk_keterangan AS Keterangan,
      IFNULL(g.gdg_nama, IFNULL(u.user_cab, h.spk_cabkaos)) AS Cabang
    FROM kencanaprint.tspk h
    LEFT JOIN tuser u ON u.user_kode = h.user_create
      AND u.user_cab NOT IN ('K04', 'B02')
    LEFT JOIN tgudang g ON g.gdg_kode = IFNULL(u.user_cab, h.spk_cabkaos)
    WHERE h.spk_divisi = 3
      AND h.spk_aktif = 'Y'
      AND h.spk_close = 0
      AND TRIM(IFNULL(h.spk_cmo, '')) <> ''
      AND h.user_create NOT IN ('ADIN', 'LUTFI')
      AND DATE(h.spk_dateline) = ?
    ORDER BY h.spk_nomor
  `;
  const [rows] = await pool.query(query, [tanggal]);
  return rows;
};

const exportHeader = getDasborData;

const exportDetail = async (filters) => {
  const { startDate, endDate } = filters;
  if (!startDate || !endDate) return [];

  const query = `
    SELECT
      DATE_FORMAT(h.spk_dateline, '%d-%m-%Y') AS Dateline,
      DATE_FORMAT(h.spk_tanggal, '%d-%m-%Y') AS TglSPK,
      h.spk_nomor AS NomorSPK,
      h.spk_nama AS NamaDesain,
      h.spk_jumlah AS Jumlah,
      h.user_create AS UserCreate,
      TRIM(IFNULL(h.spk_cmo, '')) AS CMO,
      h.spk_pending AS StatusPending,
      h.spk_statuskerja AS StatusKerja,
      h.spk_ketpending AS KetPending,
      IFNULL(g.gdg_nama, IFNULL(u.user_cab, h.spk_cabkaos)) AS Cabang
    FROM kencanaprint.tspk h
    LEFT JOIN tuser u ON u.user_kode = h.user_create
      AND u.user_cab NOT IN ('K04', 'B02')
    LEFT JOIN tgudang g ON g.gdg_kode = IFNULL(u.user_cab, h.spk_cabkaos)
    WHERE h.spk_divisi = 3
      AND h.spk_aktif = 'Y'
      AND h.spk_close = 0
      AND TRIM(IFNULL(h.spk_cmo, '')) <> ''
      AND h.spk_dateline IS NOT NULL
      AND h.user_create NOT IN ('ADIN', 'LUTFI')
      AND DATE(h.spk_dateline) BETWEEN ? AND ?
    ORDER BY h.spk_dateline, h.spk_nomor
  `;
  const [rows] = await pool.query(query, [startDate, endDate]);
  return rows;
};

module.exports = {
  getCabangList,
  getKuota,
  saveKuota,
  getDasborData,
  getDasborDetail,
  exportHeader,
  exportDetail,
};
