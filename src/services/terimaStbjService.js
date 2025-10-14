const pool = require("../config/database");

const getList = async (filters, user) => {
  const { startDate, endDate, gudang } = filters;
  const query = `
        SELECT 
            h.stbj_nomor AS nomor,
            h.stbj_tanggal AS tanggal,
            h.stbj_keterangan AS keterangan,
            g.gdg_nama AS asalGudang,
            IFNULL(ts.ts_nomor, "") AS nomorTerima,
            ts.ts_tanggal AS tglTerima,
            IFNULL(tl.tl_nomor, "") AS nomorTolak,
            tl.tl_tanggal AS tglTolak,
            (
                SELECT CASE 
                    WHEN pin_acc = "" AND pin_dipakai = "" THEN "WAIT"
                    WHEN pin_acc = "Y" AND pin_dipakai = "" THEN "ACC"
                    WHEN pin_acc = "N" THEN "TOLAK"
                    ELSE ""
                END
                FROM kencanaprint.tspk_pin5 
                WHERE pin_trs = "BATAL TERIMA STBJ" AND pin_nomor = IFNULL(ts.ts_nomor, "") 
                ORDER BY pin_urut DESC LIMIT 1
            ) AS statusPengajuan,
            h.user_create AS userCreate,
            IFNULL(ts.ts_closing, "N") AS closing
        FROM kencanaprint.tstbj_hdr h
        LEFT JOIN kencanaprint.tgudang g ON g.gdg_kode = h.stbj_gdg_kode 
        LEFT JOIN tdc_stbj_hdr ts ON ts.ts_stbj = h.stbj_nomor
        LEFT JOIN tdc_stbjtolak tl ON tl.tl_stbj = h.stbj_nomor
        WHERE h.stbj_tanggal BETWEEN ? AND ?
          AND h.stbj_gdg_kode = ?
        ORDER BY ts.ts_nomor, h.stbj_nomor;
    `;
  const [rows] = await pool.query(query, [startDate, endDate, gudang]);
  return rows;
};

const getDetails = async (nomor) => {
  // Query ini adalah terjemahan dari SQLDetail di Delphi
  const query = `
        SELECT 
            h.ts_stbj AS nomor, 
            d.tsd_nomor AS nomorTerima,
            d.tsd_spk_nomor AS spk,
            d.tsd_kode AS kode,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
            d.tsd_ukuran AS ukuran,
            d.tsd_jumlah AS jumlah
        FROM tdc_stbj_hdr h
        INNER JOIN tdc_stbj_dtl d ON d.tsd_nomor = h.ts_nomor
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.tsd_kode
        WHERE h.ts_stbj = ?
        ORDER BY d.tsd_nomor, d.tsd_spk_nomor, d.tsd_kode, d.tsd_ukuran;
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

const cancelReceipt = async (nomorKirim, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Ambil data relevan dari DUA tabel
    const [rows] = await connection.query(
      `SELECT 
        h.stbj_nomor,
        ts.ts_nomor, 
        ts.ts_closing
      FROM kencanaprint.tstbj_hdr h
      LEFT JOIN tdc_stbj_hdr ts ON h.stbj_nomor = ts.ts_stbj
      WHERE h.stbj_nomor = ?`,
      [nomorKirim]
    );

    if (rows.length === 0 || !rows[0].ts_nomor) {
      throw new Error("STBJ ini belum pernah diterima atau tidak ditemukan.");
    }
    const doc = rows[0];

    // --- VALIDASI DARI DELPHI ---
    if (doc.ts_closing === "Y")
      throw new Error("Sudah Closing, tidak bisa dibatalkan.");

    const [sjRows] = await connection.query(
      'SELECT sj_noterima FROM tdc_sj_hdr WHERE sj_stbj = ? AND sj_noterima <> "" LIMIT 1',
      [doc.stbj_nomor]
    );
    if (sjRows.length > 0) {
      throw new Error(
        `Data ini ada SJ ke Store yg sudah diterima dengan Nomor: ${sjRows[0].sj_noterima}`
      );
    }
    // --- AKHIR VALIDASI ---

    const nomorTerima = doc.ts_nomor;

    // Hapus header dan detail penerimaan
    await connection.query("DELETE FROM tdc_stbj_dtl WHERE tsd_nomor = ?", [
      nomorTerima,
    ]);
    await connection.query("DELETE FROM tdc_stbj_hdr WHERE ts_nomor = ?", [
      nomorTerima,
    ]);

    // ✅ DIHAPUS: UPDATE ke kencanaprint.tstbj_hdr karena column ts_nomor tidak ada
    // await connection.query(
    //   "UPDATE kencanaprint.tstbj_hdr SET ts_nomor = NULL WHERE stbj_nomor = ?",
    //   [nomorKirim]
    // );

    await connection.commit();
    return {
      message: `Penerimaan untuk STBJ dengan nomor ${nomorKirim} berhasil dibatalkan.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const cancelRejection = async (nomorKirim, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Ambil data relevan
    const [rows] = await connection.query(
      `SELECT ts.ts_nomor, tl.tl_nomor 
             FROM kencanaprint.tstbj_hdr h
             LEFT JOIN tdc_stbj_hdr ts ON h.stbj_nomor = ts.ts_stbj
             LEFT JOIN tdc_stbjtolak tl ON h.stbj_nomor = tl.tl_stbj
             WHERE h.stbj_nomor = ?`,
      [nomorKirim]
    );

    if (rows.length === 0) throw new Error("Dokumen STBJ tidak ditemukan.");
    const doc = rows[0];

    // --- VALIDASI DARI DELPHI (cxButton5Click) ---
    if (!doc.tl_nomor) throw new Error("STBJ ini belum ditolak.");
    if (doc.ts_nomor)
      throw new Error(
        "STBJ ini sudah diterima, tidak bisa dibatalkan penolakannya."
      );

    // Cek apakah sudah dibuat pengiriman dari Gudang Repair
    const [grRows] = await connection.query(
      "SELECT 1 FROM tdc_gr_hdr WHERE gr_tl_nomor = ? LIMIT 1",
      [doc.tl_nomor]
    );
    if (grRows.length > 0) {
      throw new Error(
        "Data ini sudah dibuatkan pengiriman dari Gudang Repair ke DC."
      );
    }
    // --- AKHIR VALIDASI ---

    // Hapus data penolakan
    await connection.query("DELETE FROM tdc_stbjtolak WHERE tl_nomor = ?", [
      doc.tl_nomor,
    ]);

    await connection.commit();
    return {
      message: `Penolakan untuk STBJ dengan nomor ${nomorKirim} berhasil dibatalkan.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getExportDetails = async (filters) => {
  const { startDate, endDate, gudang } = filters;
  const query = `
        SELECT 
            h.stbj_nomor AS 'Nomor STBJ',
            h.stbj_tanggal AS 'Tgl Kirim',
            g.gdg_nama AS 'Asal Gudang',
            ts.ts_nomor AS 'Nomor Terima',
            ts.ts_tanggal AS 'Tgl Terima',
            d.tsd_spk_nomor AS 'SPK',
            d.tsd_kode AS 'Kode Barang',
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS 'Nama Barang',
            d.tsd_ukuran AS 'Ukuran',
            d.tsd_jumlah AS 'Jumlah'
        FROM kencanaprint.tstbj_hdr h
        INNER JOIN tdc_stbj_hdr ts ON h.stbj_nomor = ts.ts_stbj
        INNER JOIN tdc_stbj_dtl d ON ts.ts_nomor = d.tsd_nomor
        LEFT JOIN kencanaprint.tgudang g ON g.gdg_kode = h.stbj_gdg_kode 
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.tsd_kode
        WHERE h.stbj_tanggal BETWEEN ? AND ?
          AND h.stbj_gdg_kode = ?
        ORDER BY h.stbj_nomor, d.tsd_spk_nomor, d.tsd_kode, d.tsd_ukuran;
    `;
  const [rows] = await pool.query(query, [startDate, endDate, gudang]);
  return rows;
};

module.exports = {
  getList,
  getDetails,
  cancelReceipt,
  cancelRejection,
  getExportDetails,
};
