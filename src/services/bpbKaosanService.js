const pool = require("../config/database");

/**
 * Mengambil daftar header BPB Kaosan.
 * Menerjemahkan TfrmBrowBPBkaosan.btnRefreshClick (SQLMaster)
 */
const getList = async (filters, user) => {
  const { startDate, endDate } = filters;

  let query = `
        SELECT 
            h.bpb_nomor AS nomor,
            h.bpb_tanggal AS tanggal,
            h.bpb_po_nomor AS nomorPO,
            h.bpb_nominal AS nominalBPB,
            h.bpb_sup_kode AS kdsup,
            s.Sup_nama AS suplier,
            s.Sup_alamat AS alamat,
            h.bpb_Keterangan AS keterangan,
            LEFT(h.bpb_nomor, 3) AS cabang,
            h.user_create AS created
        FROM retail.tdc_bpb_hdr h
        LEFT JOIN retail.tsupplier s ON s.sup_kode = h.bpb_sup_kode
        WHERE h.bpb_tanggal BETWEEN ? AND ?
    `;
  const params = [startDate, endDate];

  // Filter per cabang jika bukan KDC
  if (user.cabang !== "KDC") {
    query += " AND LEFT(h.bpb_nomor, 3) = ?";
    params.push(user.cabang);
  }

  query += " ORDER BY h.date_create";

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil data detail untuk baris master.
 * Menerjemahkan TfrmBrowBPBkaosan.btnRefreshClick (SQLDetail)
 */
const getDetails = async (nomor) => {
  const query = `
        SELECT 
            d.bpbd_nomor AS nomor,
            d.bpbd_kode AS kode,
            a.brg_warna AS nama,
            a.brg_bahan AS bahan,
            d.bpbd_ukuran AS ukuran,
            d.bpbd_bagus AS qtyBagus,
            d.bpbd_bs AS qtyBS,
            d.bpbd_jumlah AS qtyTerima,
            d.bpbd_hargabagus AS hargaBagus,
            d.bpbd_hargabs AS hargaBS,
            ((d.bpbd_bagus * d.bpbd_hargabagus) + (d.bpbd_bs * d.bpbd_hargabs)) AS total
        FROM retail.tdc_bpb_dtl d
        LEFT JOIN retail.tdc_bpb_hdr h ON h.bpb_nomor = d.bpbd_nomor
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.bpbd_kode
        WHERE h.bpb_nomor = ?
        ORDER BY h.bpb_nomor, d.bpbd_kode
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

/**
 * Menghapus data BPB Kaosan dan memperbarui status PO terkait.
 * Menerjemahkan TfrmBrowBPBkaosan.cxButton4Click
 */
const deleteBPB = async (nomor, nomorPO, cabang, user) => {
  // Validasi kepemilikan cabang (Delphi)
  if (user.cabang !== "KDC" && user.cabang !== cabang) {
    throw new Error("Hanya boleh menghapus cabang milik Anda.");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Dapatkan total PO dan total BPB (tanpa BPB yang akan dihapus)
    const [poRows] = await connection.query(
      `SELECT 
                a.pod_jumlah,
                IFNULL((SELECT SUM(d.bpbd_jumlah) FROM tdc_bpb_hdr h INNER JOIN tdc_bpb_dtl d ON d.bpbd_nomor=h.bpb_nomor
                 WHERE h.bpb_po_nomor=a.pod_nomor AND d.bpbd_kode=a.pod_kode AND d.bpbd_ukuran=a.pod_ukuran 
                 AND d.bpbd_nomor <> ?), 0) AS bpb
             FROM tdc_po_dtl a
             WHERE a.pod_nomor = ?`,
      [nomor, nomorPO]
    );

    let totalPO = 0;
    let totalBPB = 0;
    poRows.forEach((row) => {
      totalPO += row.pod_jumlah;
      totalBPB += row.bpb <= row.pod_jumlah ? row.bpb : row.pod_jumlah;
    });

    // 2. Tentukan status PO baru
    let newPoStatus = 0; // OPEN
    if (totalBPB >= totalPO) {
      newPoStatus = 1; // CLOSE
    } else if (totalBPB > 0 && totalBPB < totalPO) {
      newPoStatus = 2; // ONPROSES
    }

    // 3. Update status PO
    await connection.query(
      "UPDATE tdc_po_hdr SET po_close = ? WHERE po_nomor = ?",
      [newPoStatus, nomorPO]
    );

    // 4. Hapus BPB Header (Asumsi detail terhapus via ON DELETE CASCADE)
    await connection.query(
      "DELETE FROM retail.tdc_bpb_hdr WHERE bpb_nomor = ?",
      [nomor]
    );

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
 * Mengambil data detail untuk export.
 */
const getExportDetails = async (filters, user) => {
  const { startDate, endDate } = filters;

  let query = `
        SELECT 
            d.bpbd_nomor AS 'Nomor BPB',
            h.bpb_tanggal AS 'Tanggal BPB',
            h.bpb_po_nomor AS 'Nomor PO',
            d.bpbd_kode AS 'Kode Barang',
            a.brg_warna AS 'Nama Barang',
            a.brg_bahan AS 'Bahan',
            d.bpbd_ukuran AS 'Ukuran',
            d.bpbd_bagus AS 'Qty Bagus',
            d.bpbd_bs AS 'Qty BS',
            d.bpbd_jumlah AS 'Qty Terima',
            d.bpbd_hargabagus AS 'Harga Bagus',
            d.bpbd_hargabs AS 'Harga BS',
            ((d.bpbd_bagus * d.bpbd_hargabagus) + (d.bpbd_bs * d.bpbd_hargabs)) AS 'Total'
        FROM retail.tdc_bpb_dtl d
        LEFT JOIN retail.tdc_bpb_hdr h ON h.bpb_nomor = d.bpbd_nomor
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.bpbd_kode
        WHERE h.bpb_tanggal BETWEEN ? AND ?
    `;
  const params = [startDate, endDate];

  if (user.cabang !== "KDC") {
    query += " AND LEFT(h.bpb_nomor, 3) = ?";
    params.push(user.cabang);
  }

  query += " ORDER BY h.bpb_nomor, d.bpbd_kode";

  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getDetails,
  deleteBPB,
  getExportDetails,
};
