const pool = require("../config/database");

/**
 * Mengambil daftar header Pengajuan Produksi (untuk approval).
 * Query identik dengan TfrmBrowPengajuanProduksi
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
 * Query identik dengan TfrmBrowPengajuanProduksi
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
 * Mengambil data detail untuk export.
 * Query identik dengan TfrmBrowPengajuanProduksi
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
  getExportDetails,
};
