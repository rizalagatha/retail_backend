const pool = require("../config/database");
const { format } = require("date-fns");

/**
 * Mengambil daftar header Pengajuan Produksi.
 */
const getList = async (filters, user) => {
  const { startDate, endDate } = filters;

  let query = `
        SELECT 
            h.pp_nomor AS nomor,
            h.pp_tanggal AS tanggal,
            h.pp_cab AS cabang,
            h.pp_sup_kode AS kdSup,
            s.Sup_nama AS supplier,
            s.Sup_alamat AS alamat,
            h.pp_ket AS keterangan,
            h.pp_dtapproved AS tglApprove,
            h.pp_approved AS approved,
            IFNULL(p.po_nomor, "") AS noPO,
            CASE
                WHEN p.po_nomor IS NULL THEN ""
                WHEN IFNULL(p.po_close, 0) = 0 THEN "OPEN"
                WHEN IFNULL(p.po_close, 0) = 1 THEN "CLOSE"
                ELSE "ONPROSES"
            END AS statusPO
        FROM retail.tdc_pengajuanproduksi_hdr h
        LEFT JOIN retail.tsupplier s ON s.sup_kode = h.pp_sup_kode
        LEFT JOIN retail.tdc_po_hdr p ON p.po_referensi = h.pp_nomor
        WHERE h.pp_tanggal BETWEEN ? AND ?
    `;
  const params = [startDate, endDate];

  // Filter per cabang jika bukan KDC
  if (user.cabang !== "KDC") {
    query += " AND h.pp_cab = ?";
    params.push(user.cabang);
  }

  query += " ORDER BY h.pp_nomor";

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil data detail untuk baris master.
 */
const getDetails = async (nomor) => {
  const query = `
        SELECT 
            d.ppd_nomor AS nomor,
            d.ppd_approved AS approve,
            d.ppd_nama AS nama,
            d.ppd_bahan AS bahan,
            d.ppd_ukuran AS ukuran,
            d.ppd_jumlah AS jumlah,
            d.ppd_harga AS harga,
            (d.ppd_jumlah * d.ppd_harga) AS total
        FROM retail.tdc_pengajuanproduksi_dtl d
        WHERE d.ppd_nomor = ?
        ORDER BY d.ppd_nomor, d.ppd_nourut
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

/**
 * Menghapus data Pengajuan Produksi.
 */
const deletePengajuan = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Ambil data untuk validasi
    const [rows] = await connection.query(
      "SELECT pp_nomor, pp_approved, pp_cab FROM retail.tdc_pengajuanproduksi_hdr WHERE pp_nomor = ?",
      [nomor]
    );
    if (rows.length === 0) throw new Error("Dokumen tidak ditemukan.");
    const doc = rows[0];

    // Validasi dari Delphi
    if (doc.pp_approved)
      throw new Error("Sudah diApprove. Tidak bisa dihapus.");
    if (user.cabang !== "KDC" && user.cabang !== doc.pp_cab) {
      throw new Error(
        `Data tsb punya Cabang ${doc.pp_cab}. Anda tidak berhak menghapus.`
      );
    }

    await connection.query(
      "DELETE FROM retail.tdc_pengajuanproduksi_hdr WHERE pp_nomor = ?",
      [nomor]
    );
    // Asumsi detail terhapus oleh ON DELETE CASCADE

    await connection.commit();
    return { message: `Pengajuan ${nomor} berhasil dihapus.` };
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
  const { startDate, endDate } = filters;

  let query = `
        SELECT 
            d.ppd_nomor AS 'Nomor Pengajuan',
            h.pp_tanggal AS 'Tanggal',
            d.ppd_approved AS 'Approve',
            d.ppd_nama AS 'Nama Barang',
            d.ppd_bahan AS 'Bahan',
            d.ppd_ukuran AS 'Ukuran',
            d.ppd_jumlah AS 'Jumlah',
            d.ppd_harga AS 'Harga',
            (d.ppd_jumlah * d.ppd_harga) AS 'Total'
        FROM retail.tdc_pengajuanproduksi_dtl d
        INNER JOIN retail.tdc_pengajuanproduksi_hdr h ON d.ppd_nomor = h.pp_nomor
        WHERE h.pp_tanggal BETWEEN ? AND ?
    `;
  const params = [startDate, endDate];

  if (user.cabang !== "KDC") {
    query += " AND h.pp_cab = ?";
    params.push(user.cabang);
  }

  query += " ORDER BY d.ppd_nomor, d.ppd_nourut";

  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getDetails,
  deletePengajuan,
  getExportDetails,
};
