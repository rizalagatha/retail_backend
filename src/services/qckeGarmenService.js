const pool = require("../config/database");
const { format, addMonths, startOfMonth, parseISO } = require("date-fns");

/**
 * Mengambil daftar header QC ke Garmen.
 * Menerjemahkan TfrmBrowQC.btnRefreshClick (SQLMaster)
 */
const getList = async (filters, user) => {
  const { startDate, endDate } = filters;

  // Query di dalam subquery 'x' adalah terjemahan dari SQLMaster
  const query = `
        SELECT 
            x.Nomor, x.Tanggal, x.NamaGudang, x.Keterangan, x.Kirim, x.Terima,
            IF(x.Terima >= x.Kirim AND x.Terima <> 0, "Y", "N") AS \`Close\`,
            x.Usr, x.Modified, x.Closing
        FROM (
            SELECT 
                h.mut_nomor AS Nomor,
                h.mut_tanggal AS Tanggal,
                g.gdg_nama AS NamaGudang,
                h.mut_ket AS Keterangan,
                IFNULL((SELECT SUM(i.mutd_jumlah) FROM tdc_qc_dtl i WHERE i.mutd_nomor = h.mut_nomor), 0) AS Kirim,
                IFNULL((SELECT SUM(i.mutd_jumlah) FROM tdc_qc_dtl2 i WHERE i.mutd_nomor = h.mut_nomor), 0) AS Terima,
                h.user_create AS Usr,
                h.user_modified AS Modified,
                h.mut_closing AS Closing
            FROM tdc_qc_hdr h
            LEFT JOIN kencanaprint.tgudang g ON g.gdg_kode = h.mut_kecab
            WHERE h.mut_tanggal BETWEEN ? AND ?
        ) x
        ORDER BY x.Tanggal
    `;
  const params = [startDate, endDate];

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil data detail untuk baris master.
 * Menerjemahkan TfrmBrowQC.btnRefreshClick (SQLDetail)
 */
const getDetails = async (nomor) => {
  const query = `
        SELECT 
            h.mut_nomor AS Nomor,
            d.mutd_kode AS Kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS Nama,
            d.mutd_ukuran AS Ukuran,
            d.mutd_jumlah AS Jumlah,
            IFNULL((
                SELECT SUM(i.mutd_jumlah) 
                FROM tdc_qc_dtl2 i 
                WHERE i.mutd_nomor = h.mut_nomor 
                  AND i.mutd_kodelama = d.mutd_kode 
                  AND i.mutd_ukuranlama = d.mutd_ukuran
            ), 0) AS SudahTerima
        FROM tdc_qc_dtl d
        INNER JOIN tdc_qc_hdr h ON d.mutd_nomor = h.mut_nomor
        LEFT JOIN tbarangdc a ON a.brg_kode = d.mutd_kode
        WHERE h.mut_nomor = ?
        ORDER BY d.mutd_nomor
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

/**
 * Menghapus data QC ke Garmen.
 * Menerjemahkan TfrmBrowQC.cxButton4Click
 */
const deleteQC = async (nomor, tanggal) => {
  // Ambil data untuk validasi
  const [rows] = await pool.query(
    "SELECT mut_closing FROM tdc_qc_hdr WHERE mut_nomor = ?",
    [nomor],
  );
  if (rows.length === 0) throw new Error("Dokumen tidak ditemukan.");
  const doc = rows[0];

  // Validasi dari Delphi
  if (doc.mut_closing === "Y")
    throw new Error("Sudah Closing Stok Opname. Tidak bisa dihapus.");

  // TODO: Implementasikan logika validasi tanggal close (zDay, zMonth, zYear)
  // const ztglclose = 20; // Ambil dari config
  // const tglDoc = parseISO(tanggal);
  // const tglBatas = startOfMonth(addMonths(tglDoc, 1));
  // tglBatas.setDate(ztglclose);
  // if (new Date() > tglBatas) {
  //     throw new Error('Transaksi tsb sudah close. Tidak bisa dihapus.');
  // }

  await pool.query("DELETE FROM tdc_qc_hdr WHERE mut_nomor = ?", [nomor]);
  // Asumsi tdc_qc_dtl dan tdc_qc_dtl2 terhapus via ON DELETE CASCADE

  return { message: `QC ${nomor} berhasil dihapus.` };
};

/**
 * Mengambil data detail untuk export.
 */
const getExportDetails = async (filters, user) => {
  const { startDate, endDate } = filters;

  let query = `
        SELECT 
            h.mut_nomor AS 'Nomor',
            h.mut_tanggal AS 'Tanggal',
            d.mutd_kode AS 'Kode',
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS 'Nama',
            d.mutd_ukuran AS 'Ukuran',
            d.mutd_jumlah AS 'Jumlah',
            IFNULL((
                SELECT SUM(i.mutd_jumlah) 
                FROM tdc_qc_dtl2 i 
                WHERE i.mutd_nomor = h.mut_nomor 
                  AND i.mutd_kodelama = d.mutd_kode 
                  AND i.mutd_ukuranlama = d.mutd_ukuran
            ), 0) AS 'SudahTerima'
        FROM tdc_qc_dtl d
        INNER JOIN tdc_qc_hdr h ON d.mutd_nomor = h.mut_nomor
        LEFT JOIN tbarangdc a ON a.brg_kode = d.mutd_kode
        WHERE h.mut_tanggal BETWEEN ? AND ?
    `;
  const params = [startDate, endDate];

  if (user.cabang !== "KDC") {
    // Asumsi filter cabang jika diperlukan, berdasarkan user
    query += " AND LEFT(h.mut_nomor, 3) = ?";
    params.push(user.cabang);
  }

  query += " ORDER BY h.mut_nomor";

  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getDetails,
  deleteQC,
  getExportDetails,
};
