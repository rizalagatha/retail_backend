const pool = require("../config/database");
const { format, parseISO, addMonths, startOfMonth } = require("date-fns");

/**
 * Mengambil daftar header Refund.
 * Menerjemahkan TfrmBrowRefund.btnRefreshClick (SQLMaster)
 */
const getList = async (filters, user) => {
  const { startDate, endDate, cabang } = filters;

  let query = `
        SELECT 
            h.rf_nomor AS Nomor,
            h.rf_tanggal AS Tanggal,
            h.user_create AS User,
            h.rf_status AS Status,
            h.rf_acc AS Approved,
            h.date_acc AS TglApprove,
            h.rf_closing AS Closing
        FROM trefund_hdr h
        WHERE h.rf_tanggal BETWEEN ? AND ?
    `;
  const params = [startDate, endDate];

  // Filter cabang
  if (user.cabang !== "KDC") {
    query += " AND LEFT(h.rf_nomor, 3) = ?";
    params.push(user.cabang);
  } else if (cabang && cabang !== "ALL") {
    query += " AND LEFT(h.rf_nomor, 3) = ?";
    params.push(cabang);
  }

  query += " ORDER BY h.rf_nomor";
  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil data detail untuk baris master.
 * Menerjemahkan TfrmBrowRefund.btnRefreshClick (SQLDetail)
 */
const getDetails = async (nomor, user) => {
  let query = `
        SELECT 
            h.rf_nomor AS Nomor,
            d.rfd_notrs AS NoTransaksi,
            d.rfd_cus_kode AS KdCus,
            c.cus_nama AS Customer,
            d.rfd_nominal AS Nominal,
            d.rfd_refund AS Approval,
            d.rfd_ket AS Keterangan
    `;

  // KDC bisa melihat detail bank
  if (user.cabang === "KDC") {
    query +=
      " ,d.rfd_bank AS BankTujuan, d.rfd_norek AS NoRekening, d.rfd_atasnama AS AtasNama";
  }

  query += `
        FROM trefund_dtl d
        INNER JOIN trefund_hdr h ON d.rfd_nomor = h.rf_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = d.rfd_cus_kode
        WHERE h.rf_nomor = ?
        ORDER BY h.rf_nomor, d.rfd_nourut
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

/**
 * Menghapus data Pengajuan Refund.
 * Menerjemahkan TfrmBrowRefund.cxButton4Click
 */
const deleteRefund = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      "SELECT rf_nomor, rf_acc, rf_closing FROM trefund_hdr WHERE rf_nomor = ?",
      [nomor]
    );
    if (rows.length === 0) throw new Error("Dokumen tidak ditemukan.");
    const doc = rows[0];

    // Validasi dari Delphi
    if (doc.rf_acc) throw new Error("Sudah diapprove. Tidak bisa dihapus.");
    if (doc.rf_closing === "Y")
      throw new Error("Sudah Closing. Tidak bisa dihapus.");
    if (nomor.substring(0, 3) !== user.cabang)
      throw new Error("Data tsb bukan dari cabang Anda.");

    await connection.query("DELETE FROM trefund_hdr WHERE rf_nomor = ?", [
      nomor,
    ]);
    // Asumsi trefund_dtl terhapus via ON DELETE CASCADE

    await connection.commit();
    // TODO: Implementasi logika sinkronisasi jika diperlukan

    return { message: `Refund ${nomor} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Mengambil data detail untuk export.
 */
const getExportDetails = async (filters, user) => {
  const { startDate, endDate, cabang } = filters;

  let query = `
        SELECT 
            h.rf_nomor AS 'Nomor Refund',
            h.rf_tanggal AS 'Tanggal Refund',
            d.rfd_notrs AS 'No Transaksi',
            d.rfd_cus_kode AS 'Kd Cus',
            c.cus_nama AS 'Customer',
            d.rfd_nominal AS 'Nominal Saldo',
            d.rfd_refund AS 'Nominal Approval',
            d.rfd_ket AS 'Keterangan'
    `;

  if (user.cabang === "KDC") {
    query +=
      " ,d.rfd_bank AS 'Bank Tujuan', d.rfd_norek AS 'No Rekening', d.rfd_atasnama AS 'Atas Nama'";
  }

  query += `
        FROM trefund_dtl d
        INNER JOIN trefund_hdr h ON d.rfd_nomor = h.rf_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = d.rfd_cus_kode
        WHERE h.rf_tanggal BETWEEN ? AND ?
    `;
  const params = [startDate, endDate];

  if (user.cabang !== "KDC") {
    query += " AND LEFT(h.rf_nomor, 3) = ?";
    params.push(user.cabang);
  } else if (cabang && cabang !== "ALL") {
    query += " AND LEFT(h.rf_nomor, 3) = ?";
    params.push(cabang);
  }

  query += " ORDER BY h.rf_nomor, d.rfd_nourut";
  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil opsi filter cabang.
 * Menerjemahkan TfrmBrowRefund.FormCreate
 */
const getCabangOptions = async (user) => {
  let query;
  const params = [];
  if (user.cabang === "KDC") {
    query =
      "SELECT 'ALL' AS kode, 'SEMUA CABANG' AS nama UNION ALL SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode NOT IN ('KBS','KPS') ORDER BY kode";
  } else {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?";
    params.push(user.cabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getDetails,
  deleteRefund,
  getExportDetails,
  getCabangOptions,
};
