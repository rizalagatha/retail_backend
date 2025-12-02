const pool = require("../config/database");

const getCabangList = async (user) => {
  let query = "";
  const params = [];
  if (user.cabang === "KDC") {
    // Logika dari Delphi: KDC bisa melihat semua cabang non-pusat
    query =
      'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode NOT IN ("KBS","KPS") ORDER BY gdg_kode';
  } else {
    // Cabang biasa hanya melihat dirinya sendiri
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ? ORDER BY gdg_kode";
    params.push(user.cabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

const getList = async (filters) => {
  const { startDate, endDate, cabang, search = "" } = filters;

  const searchTerm = `%${search}%`;

  const query = `
    SELECT 
        h.sh_nomor AS Nomor,
        h.sh_tanggal AS Tanggal, 
        CASE 
            WHEN h.sh_jenis = 0 THEN "TUNAI"
            WHEN h.sh_jenis = 1 THEN "TRANSFER"
            ELSE "GIRO"
        END AS JenisBayar,
        h.sh_nominal AS Nominal,
        IFNULL(SUM(d.sd_bayar), 0) AS diBayarkan,
        (h.sh_nominal - IFNULL(SUM(d.sd_bayar), 0)) AS Sisa,
        IF(j.jur_no IS NULL, "BELUM", "SUDAH") AS Posting,
        h.sh_so_nomor AS NoSO,
        h.sh_akun AS Akun,
        h.sh_norek AS NoRekening,
        r.rek_nama AS NamaBank,
        h.sh_tgltransfer AS TglTransfer, 
        h.sh_giro AS NoGiro,
        h.sh_tglgiro AS TglGiro, 
        h.sh_tempogiro AS TglJatuhTempo,
        c.cus_kode AS KdCus,
        c.cus_nama AS Customer,
        c.cus_alamat AS Alamat,
        c.cus_kota AS Kota,
        c.cus_telp AS Telepon,
        h.sh_ket AS Keterangan, 
        IF(h.sh_otomatis = "Y", "YA", "") AS Otomatis,
        h.sh_closing AS Closing,
        h.user_create AS UserCreate,
        h.date_create AS DateCreate,
        h.user_modified AS UserModified,
        h.date_modified AS DateModified
    FROM tsetor_hdr h
    LEFT JOIN tsetor_dtl d ON d.sd_sh_nomor = h.sh_nomor
    LEFT JOIN tcustomer c ON c.cus_kode = h.sh_cus_kode
    LEFT JOIN finance.trekening r ON r.rek_kode = h.sh_akun
    LEFT JOIN finance.tjurnal j ON j.jur_nomor = h.sh_nomor
    WHERE h.sh_cab = ? 
      AND h.sh_tanggal BETWEEN ? AND ?
      AND (
            h.sh_nomor LIKE ?
        OR  c.cus_nama LIKE ?
        OR  c.cus_kode LIKE ?
        OR  h.sh_so_nomor LIKE ?
        OR  h.sh_ket LIKE ?
      )
    GROUP BY h.sh_nomor
    ORDER BY h.sh_tanggal DESC, h.sh_nomor DESC;
  `;

  const params = [
    cabang,
    startDate,
    endDate,
    searchTerm,
    searchTerm,
    searchTerm,
    searchTerm,
    searchTerm,
  ];

  const [rows] = await pool.query(query, params);
  return rows;
};

const getDetails = async (nomor) => {
  const query = `
    SELECT 
      d.sd_tanggal AS TglBayar,
      d.sd_inv AS Invoice,
      ph.ph_tanggal AS TglInvoice,
      ph.ph_top AS Top,
      DATE_FORMAT(DATE_ADD(ph.ph_tanggal, INTERVAL ph.ph_top DAY), "%d/%m/%Y") AS JatuhTempo,
      ph.ph_nominal AS Nominal,
      d.sd_bayar AS Bayar,
      d.sd_ket AS Keterangan
    FROM tsetor_dtl d
    LEFT JOIN tsetor_hdr h ON h.sh_nomor = d.sd_sh_nomor
    LEFT JOIN tpiutang_dtl pd ON pd.pd_sd_angsur = d.sd_angsur AND d.sd_angsur <> ""
    LEFT JOIN tpiutang_hdr ph ON ph.ph_nomor = pd.pd_ph_nomor
    WHERE d.sd_sh_nomor = ?
    ORDER BY d.sd_nourut, d.sd_angsur;
  `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

const remove = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT sh_otomatis, sh_closing, sh_so_nomor, 
        (SELECT COUNT(*) FROM finance.tjurnal WHERE jur_nomor = sh_nomor) > 0 AS isPosted 
        FROM tsetor_hdr WHERE sh_nomor = ?`,
      [nomor]
    );
    if (rows.length === 0) throw new Error("Data tidak ditemukan.");
    const setoran = rows[0];

    // Migrasi validasi dari Delphi
    if (setoran.sh_otomatis === "Y")
      throw new Error("Setoran Otomatis tidak bisa dihapus.");
    if (nomor.substring(0, 3) !== user.cabang)
      throw new Error(
        `Anda tidak berhak menghapus data milik cabang ${nomor.substring(
          0,
          3
        )}.`
      );
    if (setoran.isPosted)
      throw new Error("Pembayaran ini sudah di-Posting oleh Finance.");
    if (setoran.sh_closing === "Y")
      throw new Error("Data setoran sudah Closing.");
    if (setoran.sh_so_nomor)
      throw new Error(`Sudah di-link ke No. SO: ${setoran.sh_so_nomor}.`);

    // Hapus data
    await connection.query("DELETE FROM tsetor_hdr WHERE sh_nomor = ?", [
      nomor,
    ]);

    await connection.commit();
    return { message: `Setoran ${nomor} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getExportDetails = async (filters) => {
  const { startDate, endDate, cabang } = filters;
  const query = `
    SELECT 
      h.sh_nomor AS 'Nomor Setoran',
      h.sh_tanggal AS 'Tanggal Setoran',
      c.cus_nama AS 'Customer',
      d.sd_tanggal AS 'Tgl Bayar',
      d.sd_inv AS 'Invoice',
      ph.ph_tanggal AS 'Tgl Invoice',
      d.sd_bayar AS 'Bayar',
      d.sd_ket AS 'Keterangan'
    FROM tsetor_hdr h
    JOIN tsetor_dtl d ON h.sh_nomor = d.sd_sh_nomor
    LEFT JOIN tcustomer c ON c.cus_kode = h.sh_cus_kode
    LEFT JOIN tpiutang_dtl pd ON pd.pd_sd_angsur = d.sd_angsur AND d.sd_angsur <> ""
    LEFT JOIN tpiutang_hdr ph ON ph.ph_nomor = pd.pd_ph_nomor
    WHERE h.sh_cab = ?
      AND h.sh_tanggal BETWEEN ? AND ?
    ORDER BY h.sh_nomor, d.sd_nourut;
  `;
  const [rows] = await pool.query(query, [cabang, startDate, endDate]);
  return rows;
};

module.exports = {
  getCabangList,
  getList,
  getDetails,
  remove,
  getExportDetails,
};
