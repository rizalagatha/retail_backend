const pool = require("../config/database");

const getList = async (filters) => {
  const { startDate, endDate, cabang, itemCode } = filters;

  const query = `
    SELECT
      h.msk_nomor AS nomor,
      h.msk_tanggal AS tanggal,
      h.msk_noterima AS nomorTerima,
      t.mst_tanggal AS tglTerima,
      f.gdg_nama AS dariStore,
      h.msk_ket AS keterangan,
      IFNULL(t.mst_closing, 'N') AS closing
    FROM tmsk_hdr h
    INNER JOIN tmsk_dtl d ON d.mskd_nomor = h.msk_nomor
    LEFT JOIN tmst_hdr t ON t.mst_nomor = h.msk_noterima
    LEFT JOIN tgudang f ON f.gdg_kode = h.msk_cab
    WHERE
      h.msk_kecab = ?
      AND h.msk_tanggal BETWEEN ? AND ?
      AND (? IS NULL OR d.mskd_kode = ?)
    GROUP BY h.msk_nomor
    ORDER BY h.msk_noterima, h.msk_tanggal DESC, h.msk_nomor DESC;
  `;
  const params = [cabang, startDate, endDate, itemCode || null, itemCode];
  const [rows] = await pool.query(query, params);
  return rows;
};

const getDetails = async (nomor) => {
  const query = `
    SELECT
      d.mskd_kode AS kode,
      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
      d.mskd_ukuran AS ukuran,
      d.mskd_jumlah AS jumlah
    FROM tmsk_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.mskd_kode
    WHERE d.mskd_nomor = ?;
  `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

// Fungsi untuk membatalkan penerimaan (meniru cxButton4Click)
const cancelReceipt = async (nomorKirim, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [headerRows] = await connection.query(
      "SELECT msk_noterima, msk_kecab FROM tmsk_hdr WHERE msk_nomor = ?",
      [nomorKirim]
    );
    if (headerRows.length === 0)
      throw new Error("Dokumen pengiriman tidak ditemukan.");
    const header = headerRows[0];
    const nomorTerima = header.msk_noterima;

    if (!nomorTerima) throw new Error("Dokumen ini memang belum diterima.");
    if (header.msk_kecab !== user.cabang)
      throw new Error(
        "Anda tidak berhak membatalkan penerimaan milik cabang lain."
      );

    const [terimaRows] = await connection.query(
      "SELECT mst_closing FROM tmst_hdr WHERE mst_nomor = ?",
      [nomorTerima]
    );
    if (terimaRows.length > 0 && terimaRows[0].mst_closing === "Y") {
      throw new Error("Penerimaan sudah di-closing dan tidak bisa dibatalkan.");
    }

    // Hapus header penerimaan
    await connection.query("DELETE FROM tmst_hdr WHERE mst_nomor = ?", [
      nomorTerima,
    ]);
    // Kosongkan referensi di header pengiriman
    await connection.query(
      'UPDATE tmsk_hdr SET msk_noterima = "" WHERE msk_nomor = ?',
      [nomorKirim]
    );

    await connection.commit();
    return {
      message: `Penerimaan untuk dokumen ${nomorKirim} berhasil dibatalkan.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getExportDetails = async (filters) => {
  const { startDate, endDate, cabang, itemCode } = filters;

  const query = `
    SELECT
      h.msk_nomor AS nomor_kirim,
      h.msk_tanggal AS tanggal_kirim,
      h.msk_noterima AS nomor_terima,
      t.mst_tanggal AS tanggal_terima,
      f.gdg_nama AS dari_store,
      d.mskd_kode AS kode_barang,
      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama_barang,
      d.mskd_ukuran AS ukuran,
      d.mskd_jumlah AS jumlah
    FROM tmsk_hdr h
    INNER JOIN tmsk_dtl d ON d.mskd_nomor = h.msk_nomor
    LEFT JOIN tmst_hdr t ON t.mst_nomor = h.msk_noterima
    LEFT JOIN tgudang f ON f.gdg_kode = h.msk_cab
    LEFT JOIN tbarangdc a ON a.brg_kode = d.mskd_kode
    WHERE
      h.msk_kecab = ?
      -- [FIX] Gunakan DATE() agar jam diabaikan
      AND DATE(h.msk_tanggal) BETWEEN ? AND ?
      AND (? IS NULL OR d.mskd_kode = ?)
    ORDER BY h.msk_nomor, d.mskd_kode, d.mskd_ukuran;
  `;
  const params = [cabang, startDate, endDate, itemCode || null, itemCode];
  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getDetails,
  cancelReceipt,
  getExportDetails,
};
