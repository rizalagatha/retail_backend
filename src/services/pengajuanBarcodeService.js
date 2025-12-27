const pool = require("../config/database");

const getList = async (filters, user) => {
  const { startDate, endDate, cabang } = filters;

  let whereClauses = ["h.pc_tanggal BETWEEN ? AND ?"];
  let params = [startDate, endDate];

  // Logika filter cabang dari Delphi
  if (user.cabang === "KDC") {
    whereClauses.push(
      'h.pc_cab IN (SELECT gdg_kode FROM tgudang WHERE gdg_kode NOT IN ("KBS", "KPS"))'
    );
  } else {
    whereClauses.push("h.pc_cab = ?");
    params.push(cabang);
  }

  const query = `
    SELECT 
      h.pc_nomor AS nomor,
      h.pc_tanggal AS tanggal,
      h.user_create AS usr,
      h.pc_acc AS approved,
      DATE_FORMAT(h.date_acc, "%d-%m-%Y %H:%i:%s") AS tglApproval,
      h.pc_closing AS closing
    FROM tpengajuanbarcode_hdr h
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY h.pc_nomor DESC;
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

const getDetails = async (nomor) => {
  const query = `
    SELECT 
      d.pcd_kode AS kode,
      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
      d.pcd_ukuran AS ukuran,
      d.pcd_jumlah AS jumlah,
      b.brgd_harga AS harga,
      IFNULL(e.pcd2_kodein, "") AS barcodeBaru
    FROM tpengajuanbarcode_dtl d
    INNER JOIN tpengajuanbarcode_hdr h ON d.pcd_nomor = h.pc_nomor
    LEFT JOIN tbarangdc a ON a.brg_kode = d.pcd_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.pcd_kode AND b.brgd_ukuran = d.pcd_ukuran
    LEFT JOIN tpengajuanbarcode_dtl2 e ON e.pcd2_nomor = d.pcd_nomor AND e.pcd2_kode = d.pcd_kode AND e.pcd2_ukuran = d.pcd_ukuran
    WHERE d.pcd_nomor = ?
    ORDER BY d.pcd_nourut;
  `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

const remove = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT pc_acc, pc_closing, pc_cab AS cabang FROM tpengajuanbarcode_hdr WHERE pc_nomor = ?",
      [nomor]
    );
    if (rows.length === 0) throw new Error("Dokumen tidak ditemukan.");
    const doc = rows[0];

    if (doc.pc_acc) throw new Error("Sudah di-approve, tidak bisa dihapus.");
    if (doc.pc_closing === "Y")
      throw new Error("Sudah Closing, tidak bisa dihapus.");
    if (doc.cabang !== user.cabang)
      throw new Error("Anda tidak berhak menghapus data cabang lain.");

    await connection.query(
      "DELETE FROM tpengajuanbarcode_dtl WHERE pcd_nomor = ?",
      [nomor]
    );
    await connection.query(
      "DELETE FROM tpengajuanbarcode_hdr WHERE pc_nomor = ?",
      [nomor]
    );

    await connection.commit();
    return { message: `Dokumen ${nomor} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getCabangOptions = async (user) => {
  let query = "";
  let params = [];
  if (user.cabang === "KDC") {
    query =
      'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode NOT IN ("KBS", "KPS") ORDER BY gdg_kode';
  } else {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?";
    params.push(user.cabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

const getExportDetails = async (filters, user) => {
  const { startDate, endDate, cabang } = filters;

  // Pastikan parameter params diinisialisasi dengan benar
  let params = [startDate, endDate];
  let whereClauses = ["DATE(h.pc_tanggal) BETWEEN ? AND ?"];

  if (user.cabang === "KDC") {
    if (cabang && cabang !== "ALL") {
      whereClauses.push("h.pc_cab = ?");
      params.push(cabang);
    } else {
      whereClauses.push(
        'h.pc_cab IN (SELECT gdg_kode FROM tgudang WHERE gdg_kode NOT IN ("KBS", "KPS"))'
      );
    }
  } else {
    whereClauses.push("h.pc_cab = ?");
    params.push(user.cabang);
  }

  const query = `
      SELECT 
        h.pc_nomor AS 'Nomor Pengajuan', 
        h.pc_tanggal AS 'Tanggal', 
        h.user_create AS 'User',
        d.pcd_kode AS 'Kode Kaos',
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS 'Nama Barang',
        d.pcd_ukuran AS 'Ukuran',
        d.pcd_jumlah AS 'Jumlah',
        d.pcd_jenis AS 'Jenis',
        d2.pcd2_kodein AS 'Barcode Baru',
        d2.pcd2_harga AS 'Harga Baru',
        d2.pcd2_diskon AS 'Diskon Persen'
      FROM tpengajuanbarcode_hdr h
      INNER JOIN tpengajuanbarcode_dtl d ON h.pc_nomor = d.pcd_nomor
      LEFT JOIN tbarangdc a ON a.brg_kode = d.pcd_kode
      
      -- [PERBAIKAN] Sesuaikan nama kolom JOIN dengan tabel dtl2 (prefix pcd2_)
      LEFT JOIN tpengajuanbarcode_dtl2 d2 ON 
          d2.pcd2_nomor = d.pcd_nomor AND 
          d2.pcd2_kode = d.pcd_kode AND 
          d2.pcd2_ukuran = d.pcd_ukuran

      WHERE ${whereClauses.join(" AND ")}
      ORDER BY h.pc_nomor, d.pcd_nourut;
    `;

  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getDetails,
  remove,
  getCabangOptions,
  getExportDetails,
};
