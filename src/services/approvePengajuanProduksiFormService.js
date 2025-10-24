const pool = require("../config/database");
const { format, parseISO } = require("date-fns");

/**
 * Mengambil data untuk form Approve Pengajuan Produksi.
 * Menerjemahkan 'loaddataall' dari TfrmApvPengajuanProduksi
 */
const getDataForApprove = async (nomor, user) => {
  const query = `
        SELECT 
            h.pp_nomor, h.pp_tanggal, h.pp_ket, h.pp_cab,
            h.pp_approved, h.pp_dtapproved,
            d.ppd_nourut AS no,
            d.ppd_nama AS nama,
            d.ppd_bahan AS bahan,
            d.ppd_ukuran AS ukuran,
            d.ppd_jumlah AS jumlah,
            d.ppd_harga AS harga,
            (d.ppd_jumlah * d.ppd_harga) AS total,
            d.ppd_approved,
            s.Sup_nama, 
            CONCAT(s.Sup_alamat, " ", s.Sup_kota) AS alamat, 
            s.sup_telp
        FROM retail.tdc_pengajuanproduksi_hdr h
        LEFT JOIN retail.tdc_pengajuanproduksi_dtl d ON d.ppd_nomor = h.pp_nomor
        LEFT JOIN retail.tsupplier s ON s.sup_kode = h.pp_sup_kode
        WHERE h.pp_nomor = ?
        ORDER BY d.ppd_nourut;
    `;

  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) throw new Error("Nomor tidak ditemukan.");

  // Proses data header
  const header = {
    nomor: rows[0].pp_nomor,
    tanggal: format(new Date(rows[0].pp_tanggal), "yyyy-MM-dd"),
    cabang: rows[0].pp_cab,
    keterangan: rows[0].pp_ket,
    supplierKode: rows[0].pp_sup_kode,
    supplierNama: rows[0].Sup_nama,
    alamat: rows[0].alamat,
    telepon: rows[0].sup_telp,
    approved: rows[0].pp_approved,
    tglApprove: rows[0].pp_dtapproved
      ? format(new Date(rows[0].pp_dtapproved), "yyyy-MM-dd")
      : format(new Date(), "yyyy-MM-dd"),
    isApproved: !!rows[0].pp_approved, // Ceklis header
  };

  // Proses data detail
  const items = rows.map((row) => ({
    id: Math.random(), // ID unik untuk frontend
    no: row.no,
    nama: row.nama,
    bahan: row.bahan,
    ukuran: row.ukuran,
    jumlah: row.jumlah,
    harga: row.harga,
    total: row.total,
    approved: row.ppd_approved === "Y", // Konversi ke boolean
  }));

  return { header, items };
};

/**
 * Menyimpan data approval.
 * Menerjemahkan 'simpandata' dari TfrmApvPengajuanProduksi
 */
const saveApproval = async (nomor, data, user) => {
  const { header, items } = data;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Update Header
    await connection.query(
      `UPDATE retail.tdc_pengajuanproduksi_hdr 
             SET pp_approved = ?, pp_dtapproved = ?
             WHERE pp_nomor = ?`,
      [
        header.isApproved ? user.kode : "",
        header.isApproved ? header.tglApprove : null,
        nomor,
      ]
    );

    // 2. Update Detail
    for (const item of items) {
      let itemApproveStatus = "";
      if (item.approved) {
        itemApproveStatus = "Y";
      } else if (header.isApproved) {
        // Jika header di-approve tapi item tidak, set 'N'
        itemApproveStatus = "N";
      }
      // Jika header tidak di-approve, item kembali ke status '' (kosong)

      await connection.query(
        `UPDATE retail.tdc_pengajuanproduksi_dtl 
                 SET ppd_approved = ? 
                 WHERE ppd_nomor = ? AND ppd_nourut = ?`,
        [itemApproveStatus, nomor, item.no]
      );
    }

    await connection.commit();
    return { message: `Approval untuk ${nomor} berhasil disimpan.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  getDataForApprove,
  saveApproval,
};
