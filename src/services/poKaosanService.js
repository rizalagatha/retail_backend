const pool = require("../config/database");
const { format, addMonths, startOfMonth } = require("date-fns");

/**
 * Mengambil daftar header PO Kaosan.
 * Menerjemahkan TfrmBrowPOKaosan.btnRefreshClick (SQLMaster)
 */
const getList = async (filters, user) => {
  const { startDate, endDate } = filters;

  let query = `
        SELECT x.Nomor, x.Tanggal, x.Nominal, x.Terbayar, (x.Nominal - x.Terbayar) AS Sisa,
               x.Kdsup, x.Supplier, x.Alamat, x.Keterangan, x.sts AS Status
        FROM (
            SELECT 
                h.po_nomor AS Nomor, h.po_tanggal AS Tanggal, h.po_sup_kode AS Kdsup,
                s.Sup_nama AS Supplier, s.Sup_alamat AS Alamat, h.po_ket AS Keterangan,
                h.po_nominal AS Nominal,
                (
                    SELECT IFNULL(SUM(v.vhd_bayar + v.vhd_pot), 0) 
                    FROM tdc_voucher_dtl v 
                    WHERE v.vhd_po = h.po_nomor
                ) AS Terbayar,
                CASE
                    WHEN h.po_close = 0 THEN 'OPEN'
                    WHEN h.po_close = 1 THEN 'CLOSE'
                    ELSE 'ONPROSES'
                END AS sts
            FROM retail.tdc_po_hdr h
            LEFT JOIN retail.tsupplier s ON s.sup_kode = h.po_sup_kode
            WHERE h.po_tanggal BETWEEN ? AND ?
        ) x
        ORDER BY x.Tanggal, x.Nomor
    `;
  const params = [startDate, endDate];

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil data detail untuk baris master.
 * Menerjemahkan TfrmBrowPOKaosan.btnRefreshClick (SQLDetail)
 */
const getDetails = async (nomor) => {
  const query = `
        SELECT 
            h.po_nomor AS Nomor, d.pod_kode AS Kode, a.brg_warna AS Nama, a.brg_bahan AS Bahan,
            d.pod_ukuran AS Ukuran, d.pod_Jumlah AS QtyPO,
            IFNULL((
                SELECT SUM(i.bpbd_Jumlah) 
                FROM tdc_bpb_dtl i 
                INNER JOIN tdc_bpb_hdr j ON j.bpb_Nomor = i.bpbd_nomor 
                WHERE j.bpb_po_nomor = h.po_Nomor AND i.bpbd_kode = d.pod_kode AND i.bpbd_ukuran = d.pod_ukuran
            ), 0) AS QtyBPB,
            d.pod_harga AS Harga, d.pod_disc AS Disc,
            (d.pod_Jumlah * d.pod_harga * ((100 - d.pod_disc) / 100)) AS NominalPO,
            d.pod_ket AS Keterangan
        FROM tdc_po_hdr h
        LEFT JOIN tdc_po_dtl d ON d.pod_nomor = h.po_nomor
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.pod_kode
        WHERE h.po_nomor = ?
        ORDER BY d.pod_nomor, d.pod_nourut
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

/**
 * Menghapus data PO Kaosan.
 * Menerjemahkan TfrmBrowPOKaosan.cxButton4Click
 */
const deletePO = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      "SELECT po_close FROM tdc_po_hdr WHERE po_nomor = ?",
      [nomor]
    );
    if (rows.length === 0) throw new Error("Dokumen PO tidak ditemukan.");

    const status = rows[0].po_close;
    if (status === 2)
      throw new Error("PO tsb sudah terima BPB. Tidak bisa dihapus.");
    if (status === 1)
      throw new Error("PO tsb Sudah Close. Tidak bisa dihapus.");

    await connection.query("DELETE FROM tdc_po_hdr WHERE po_nomor = ?", [
      nomor,
    ]);
    // Asumsi tdc_po_dtl terhapus via ON DELETE CASCADE

    await connection.commit();
    return { message: "Berhasil dihapus" };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Mengubah status Close / Batal Close PO.
 * Menerjemahkan TfrmBrowPOKaosan.Close1Click
 */
const toggleClosePO = async (nomor, user) => {
  const [rows] = await pool.query(
    "SELECT po_close FROM tdc_po_hdr WHERE po_nomor = ?",
    [nomor]
  );
  if (rows.length === 0) throw new Error("Dokumen PO tidak ditemukan.");

  let newStatus = 0;
  let newStatusString = "OPEN";
  let message = "";

  if (rows[0].po_close === 0 || rows[0].po_close === 2) {
    // Jika OPEN atau ONPROSES
    newStatus = 1;
    newStatusString = "CLOSE";
    message = "PO berhasil di-Close.";
  } else {
    // Jika CLOSE
    // Logika Batal Close dari Delphi
    const [detailRows] = await pool.query(
      `SELECT a.pod_jumlah,
             IFNULL((SELECT SUM(d.bpbd_jumlah) FROM tdc_bpb_hdr h INNER JOIN tdc_bpb_dtl d ON d.bpbd_nomor=h.bpb_nomor
             WHERE h.bpb_po_nomor=a.pod_nomor AND d.bpbd_kode=a.pod_kode AND d.bpbd_ukuran=a.pod_ukuran),0) bpb
             FROM tdc_po_dtl a
             WHERE a.pod_nomor = ?`,
      [nomor]
    );

    let totalPO = 0;
    let totalBPB = 0;
    detailRows.forEach((row) => {
      totalPO += row.pod_jumlah;
      totalBPB += row.bpb <= row.pod_jumlah ? row.bpb : row.pod_jumlah;
    });

    if (totalBPB >= totalPO) {
      newStatus = 1;
      newStatusString = "CLOSE";
      message = "Berdasarkan penerimaan BPB, PO ini memang sudah close.";
    } else if (totalBPB > 0 && totalBPB < totalPO) {
      newStatus = 2;
      newStatusString = "ONPROSES";
      message = "Berhasil dibatalkan, status PO diubah menjadi ONPROSES.";
    } else {
      newStatus = 0;
      newStatusString = "OPEN";
      message = "Berhasil dibatalkan, status PO diubah menjadi OPEN.";
    }
  }

  await pool.query("UPDATE tdc_po_hdr SET po_close = ? WHERE po_nomor = ?", [
    newStatus,
    nomor,
  ]);
  return { message, newStatus: newStatusString };
};

/**
 * Mengambil data detail PO Kaosan untuk export.
 * Menerjemahkan TfrmBrowPOKaosan.btnRefreshClick (SQLDetail)
 */
const getExportDetails = async (filters, user) => {
  const { startDate, endDate } = filters;

  // Query dari SQLDetail
  let query = `
        SELECT 
            h.po_nomor AS 'Nomor PO',
            h.po_tanggal AS 'Tanggal PO',
            h.po_sup_kode AS 'Kode Supplier',
            s.Sup_nama AS 'Nama Supplier',
            d.pod_kode AS 'Kode Barang',
            a.brg_warna AS 'Nama Barang',
            a.brg_bahan AS 'Bahan',
            d.pod_ukuran AS 'Ukuran',
            d.pod_Jumlah AS 'Qty PO',
            IFNULL((
                SELECT SUM(i.bpbd_Jumlah) 
                FROM tdc_bpb_dtl i 
                INNER JOIN tdc_bpb_hdr j ON j.bpb_Nomor = i.bpbd_nomor 
                WHERE j.bpb_po_nomor = h.po_Nomor AND i.bpbd_kode = d.pod_kode AND i.bpbd_ukuran = d.pod_ukuran
            ), 0) AS 'Qty BPB',
            d.pod_harga AS 'Harga',
            d.pod_disc AS 'Disc (%)',
            (d.pod_Jumlah * d.pod_harga * ((100 - d.pod_disc) / 100)) AS 'Nominal PO',
            d.pod_ket AS 'Keterangan'
        FROM tdc_po_hdr h
        LEFT JOIN tdc_po_dtl d ON d.pod_nomor = h.po_nomor
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.pod_kode
        LEFT JOIN retail.tsupplier s ON s.sup_kode = h.po_sup_kode
        WHERE h.po_tanggal BETWEEN ? AND ?
        ORDER BY d.pod_nomor, d.pod_nourut
    `;

  const params = [startDate, endDate];

  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getDetails,
  deletePO,
  toggleClosePO,
  getExportDetails,
};
