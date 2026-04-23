const pool = require("../config/database");

const getList = async (filters) => {
  const { startDate, endDate, cabang, itemCode } = filters;

  // Jika cabang 'ALL' (Mata dewa KDC/W01), tampilkan semua tujuan workshop
  const cabangFilter = cabang === "ALL" ? "" : "AND h.mw_cab_tujuan = ?";
  const params =
    cabang === "ALL"
      ? [startDate, endDate, itemCode || null, itemCode]
      : [startDate, endDate, cabang, itemCode || null, itemCode];

  const query = `
    SELECT
      h.mw_nomor AS nomor,
      h.mw_tanggal AS tanggal,
      h.mw_noterima AS nomorTerima,
      t.mwt_tanggal AS tglTerima,
      f.gdg_nama AS dariStore,
      h.mw_ket AS keterangan,
      IFNULL(t.mwt_closing, 'N') AS closing
    FROM tmutasi_workshop_hdr h
    INNER JOIN tmutasi_workshop_dtl d ON d.mwd_nomor = h.mw_nomor
    -- [BARU] Join ke tabel tmwt_hdr khusus workshop
    LEFT JOIN tmwt_hdr t ON t.mwt_nomor = h.mw_noterima 
    LEFT JOIN tgudang f ON f.gdg_kode = h.mw_cab_asal
    WHERE
      h.mw_tanggal BETWEEN ? AND ?
      ${cabangFilter}
      AND (? IS NULL OR d.mwd_kode = ?)
    GROUP BY h.mw_nomor
    ORDER BY h.mw_noterima, h.mw_tanggal DESC, h.mw_nomor DESC;
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

const getDetails = async (nomor) => {
  // Detail Browse mengambil dari data PENGIRIMAN karena kita butuh tau apa yang harus diterima
  const query = `
    SELECT
      d.mwd_kode AS kode,
      TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), ' ', IFNULL(a.brg_tipe,''), ' ', IFNULL(a.brg_lengan,''), ' ', IFNULL(a.brg_jeniskain,''), ' ', IFNULL(a.brg_warna,''))) AS nama,
      d.mwd_ukuran AS ukuran,
      d.mwd_jumlah AS jumlah
    FROM tmutasi_workshop_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.mwd_kode
    WHERE d.mwd_nomor = ?;
  `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

const cancelReceipt = async (nomorKirim, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [headerRows] = await connection.query(
      "SELECT mw_noterima, mw_cab_tujuan FROM tmutasi_workshop_hdr WHERE mw_nomor = ?",
      [nomorKirim],
    );
    if (headerRows.length === 0)
      throw new Error("Dokumen pengiriman tidak ditemukan.");

    const header = headerRows[0];
    const nomorTerima = header.mw_noterima;

    if (!nomorTerima) throw new Error("Dokumen ini memang belum diterima.");

    // Proteksi agar cabang lain tidak iseng membatalkan
    if (
      header.mw_cab_tujuan !== user.cabang &&
      user.cabang !== "KDC" &&
      user.cabang !== "W01"
    ) {
      throw new Error(
        "Anda tidak berhak membatalkan penerimaan milik workshop lain.",
      );
    }

    const [terimaRows] = await connection.query(
      "SELECT mwt_closing FROM tmwt_hdr WHERE mwt_nomor = ?",
      [nomorTerima],
    );

    if (terimaRows.length > 0 && terimaRows[0].mwt_closing === "Y") {
      throw new Error("Penerimaan sudah di-closing dan tidak bisa dibatalkan.");
    }

    // [BARU] Hapus header & detail penerimaan di tabel khusus Workshop
    await connection.query("DELETE FROM tmwt_hdr WHERE mwt_nomor = ?", [
      nomorTerima,
    ]);
    await connection.query("DELETE FROM tmwt_dtl WHERE mwtd_nomor = ?", [
      nomorTerima,
    ]);

    // Kosongkan referensi di header pengiriman workshop
    await connection.query(
      'UPDATE tmutasi_workshop_hdr SET mw_noterima = "" WHERE mw_nomor = ?',
      [nomorKirim],
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

  const cabangFilter = cabang === "ALL" ? "" : "AND h.mw_cab_tujuan = ?";
  const params =
    cabang === "ALL"
      ? [startDate, endDate, itemCode || null, itemCode]
      : [startDate, endDate, cabang, itemCode || null, itemCode];

  const query = `
    SELECT
      h.mw_nomor AS nomor_kirim,
      DATE_FORMAT(h.mw_tanggal, '%Y-%m-%d') AS tanggal_kirim,
      h.mw_noterima AS nomor_terima,
      DATE_FORMAT(t.mwt_tanggal, '%Y-%m-%d') AS tanggal_terima,
      f.gdg_nama AS dari_store,
      d.mwd_kode AS kode_barang,
      TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), ' ', IFNULL(a.brg_tipe,''), ' ', IFNULL(a.brg_lengan,''), ' ', IFNULL(a.brg_jeniskain,''), ' ', IFNULL(a.brg_warna,''))) AS nama_barang,
      d.mwd_ukuran AS ukuran,
      d.mwd_jumlah AS jumlah
    FROM tmutasi_workshop_hdr h
    INNER JOIN tmutasi_workshop_dtl d ON d.mwd_nomor = h.mw_nomor
    LEFT JOIN tmwt_hdr t ON t.mwt_nomor = h.mw_noterima
    LEFT JOIN tgudang f ON f.gdg_kode = h.mw_cab_asal
    LEFT JOIN tbarangdc a ON a.brg_kode = d.mwd_kode
    WHERE
      DATE(h.mw_tanggal) BETWEEN ? AND ?
      ${cabangFilter}
      AND (? IS NULL OR d.mwd_kode = ?)
    ORDER BY h.mw_nomor, d.mwd_kode, d.mwd_ukuran;
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getDetails,
  cancelReceipt,
  getExportDetails,
};
