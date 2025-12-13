const pool = require("../config/database");

/**
 * Mengambil daftar header Surat Jalan berdasarkan filter.
 * @param {object} filters - Objek berisi startDate, endDate, kodeBarang.
 * @returns {Promise<Array>}
 */
const getList = async (filters) => {
  const { startDate, endDate, kodeBarang, cabang } = filters;

  let params = [startDate, endDate, cabang];
  let itemFilter = "";

  if (kodeBarang) {
    itemFilter = "AND d.sjd_kode = ?";
    params.push(kodeBarang);
  }

  const query = `
        SELECT 
            h.sj_nomor AS Nomor,
            h.sj_tanggal AS Tanggal,
            h.sj_kecab AS Store,
            g.gdg_nama AS Nama_Store,
            h.sj_mt_nomor AS NoMinta,
            m.mt_tanggal AS TglMinta,
            IFNULL(m.mt_otomatis, "") AS MintaOtomatis,
            h.sj_noterima AS NomorTerima,
            t.tj_tanggal AS TglTerima,
            h.sj_ket AS Keterangan,
            sj_stbj AS NoSTBJ,
            IFNULL((
                SELECT IFNULL(
                    IF(pin_acc="" AND pin_dipakai="", "WAIT",
                        IF(pin_acc="Y" AND pin_dipakai="", "ACC",
                            IF(pin_acc="Y" AND pin_dipakai="Y", "",
                                IF(pin_acc="N", "TOLAK", "")
                            )
                        )
                    ), ""
                )
                FROM kencanaprint.tspk_pin5 
                WHERE pin_trs="SURAT JALAN" AND pin_nomor=h.sj_nomor 
                ORDER BY pin_urut DESC LIMIT 1
            ), "") AS Ngedit,
            h.user_create AS Usr,
            sj_closing AS Closing
        FROM tdc_sj_hdr h
        INNER JOIN tdc_sj_dtl d ON d.sjd_nomor = h.sj_nomor
        LEFT JOIN retail.tgudang g ON g.gdg_kode = h.sj_kecab
        LEFT JOIN retail.ttrm_sj_hdr t ON t.tj_nomor = h.sj_noterima
        LEFT JOIN retail.tmintabarang_hdr m ON m.mt_nomor = h.sj_mt_nomor
        WHERE h.sj_peminta = "" 
          AND h.sj_tanggal BETWEEN ? AND ?
          AND h.sj_kecab = ?
          ${itemFilter}
        GROUP BY h.sj_nomor 
        ORDER BY h.date_create DESC
    `;

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil detail item dari sebuah Surat Jalan.
 * @param {string} nomor - Nomor Surat Jalan.
 * @returns {Promise<Array>}
 */
const getDetails = async (nomor) => {
  const query = `
        SELECT 
            d.sjd_kode AS Kode,
            CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna) AS Nama,
            d.sjd_ukuran AS Ukuran,
            d.sjd_jumlah AS Jumlah
        FROM tdc_sj_dtl d
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.sjd_kode
        WHERE d.sjd_nomor = ?
        ORDER BY d.sjd_kode;
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

/**
 * Menghapus data Surat Jalan.
 * @param {string} nomor - Nomor Surat Jalan.
 * @returns {Promise<object>}
 */
const remove = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [headers] = await connection.query(
      "SELECT sj_noterima, sj_stbj, sj_closing FROM tdc_sj_hdr WHERE sj_nomor = ?",
      [nomor]
    );
    if (headers.length === 0) {
      throw new Error("Data tidak ditemukan.");
    }
    const sj = headers[0];

    // Migrasi Validasi dari Delphi (cxButton4Click)
    if (sj.sj_noterima) {
      throw new Error("Sudah ada penerimaan. Tidak bisa dihapus.");
    }
    if (sj.sj_stbj) {
      throw new Error("SJ Otomatis dari Terima STBJ. Tidak bisa dihapus.");
    }
    if (sj.sj_closing === "Y") {
      throw new Error("Sudah Closing Stok Opname. Tidak bisa dihapus.");
    }

    await connection.query("DELETE FROM tdc_sj_hdr WHERE sj_nomor = ?", [
      nomor,
    ]);
    await connection.query("DELETE FROM tdc_sj_dtl WHERE sjd_nomor = ?", [
      nomor,
    ]);

    // Log sinkronisasi (jika diperlukan)
    const ccab = nomor.substring(0, 3);
    if (["K02", "K03", "K04", "K05", "K06", "K07", "K08"].includes(ccab)) {
      const logSql = `
                INSERT INTO kencanaprint.tlog_sync (log_tabel, log_nomor, log_cab, log_task, log_sync) 
                VALUES ('tdc_sj_hdr', ?, ?, "DELETE", "Y") 
                ON DUPLICATE KEY UPDATE log_sync="Y"
             `;
      await connection.query(logSql, [nomor, ccab]);
    }

    await connection.commit();
    return { message: `Surat Jalan ${nomor} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Mendapatkan status terakhir pengajuan perubahan.
 * @param {string} nomor - Nomor Surat Jalan.
 * @returns {Promise<object>}
 */
const getRequestStatus = async (nomor) => {
  const query = `
        SELECT pin_urut, pin_alasan, pin_dipakai 
        FROM kencanaprint.tspk_pin5 
        WHERE pin_trs="SURAT JALAN" AND pin_nomor = ?
        ORDER BY pin_urut DESC LIMIT 1
    `;
  const [rows] = await pool.query(query, [nomor]);

  if (rows.length === 0) {
    return { nextUrut: 1, alasan: "" };
  }

  const lastRequest = rows[0];
  if (lastRequest.pin_dipakai === "") {
    return { nextUrut: lastRequest.pin_urut, alasan: lastRequest.pin_alasan };
  } else {
    return { nextUrut: lastRequest.pin_urut + 1, alasan: "" };
  }
};

/**
 * Mengajukan permintaan perubahan data.
 * @param {object} payload - Data pengajuan.
 * @returns {Promise<object>}
 */
const submitRequest = async (payload) => {
  const { nomor, tanggal, keterangan, alasan, urut, kdUser } = payload;

  if (!alasan || !alasan.trim()) {
    throw new Error("Alasan harus diisi.");
  }

  const query = `
        INSERT INTO kencanaprint.tspk_pin5 (
            pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, 
            pin_tgl_minta, pin_user_minta, pin_alasan
        ) VALUES (
            "SURAT JALAN", ?, ?, ?, ?, NOW(), ?, ?
        ) ON DUPLICATE KEY UPDATE 
            pin_tgl_trs = VALUES(pin_tgl_trs),
            pin_ket = VALUES(pin_ket),
            pin_acc = "",
            pin_dipakai = "",
            pin_tgl_minta = NOW(),
            pin_user_minta = VALUES(pin_user_minta),
            pin_alasan = VALUES(pin_alasan)
    `;

  await pool.query(query, [nomor, urut, tanggal, keterangan, kdUser, alasan]);
  return { message: "Pengajuan perubahan berhasil. Menunggu ACC." };
};

/**
 * Mengambil data yang diformat untuk cetak Surat Jalan.
 * @param {string} nomor - Nomor Surat Jalan.
 * @returns {Promise<object>}
 */
// GANTI FUNGSI LAMA DENGAN INI:
const getPrintData = async (nomor) => {
  // 1. Query untuk header, mengambil data SJ, data store tujuan, dan data perusahaan pengirim
  const headerQuery = `
        SELECT 
            h.sj_nomor,
            h.sj_tanggal,
            h.sj_mt_nomor,
            h.sj_ket,
            h.user_create,
            h.date_create,
            CONCAT(h.sj_kecab, ' - ', g.gdg_nama) AS store,
            src.gdg_inv_nama AS perush_nama,
            src.gdg_inv_alamat AS perush_alamat,
            src.gdg_inv_telp AS perush_telp
        FROM tdc_sj_hdr h
        LEFT JOIN tgudang g ON g.gdg_kode = h.sj_kecab
        LEFT JOIN tgudang src ON src.gdg_kode = LEFT(h.sj_nomor, 3)
        WHERE h.sj_nomor = ?;
    `;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0) {
    throw new Error("Data Surat Jalan tidak ditemukan.");
  }

  // 2. Query untuk detail item
  const detailQuery = `
    SELECT 
        d.sjd_kode,
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama_barang,
        d.sjd_ukuran,
        d.sjd_jumlah
    FROM tdc_sj_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.sjd_kode
    WHERE d.sjd_nomor = ?
    ORDER BY d.sjd_kode, d.sjd_ukuran;
    `;
  const [detailRows] = await pool.query(detailQuery, [nomor]);

  return {
    header: headerRows[0],
    details: detailRows,
  };
};

const getCabangList = async (user) => {
  let query = "";
  const params = [];

  if (user.cabang === "KDC") {
    query = `
      SELECT gdg_kode AS kode, gdg_nama AS nama
      FROM tgudang
      ORDER BY gdg_kode
    `;
  } else {
    query = `
      SELECT gdg_kode AS kode, gdg_nama AS nama
      FROM tgudang
      WHERE gdg_kode = ?
      ORDER BY gdg_kode
    `;
    params.push(user.cabang);
  }

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil data detail lengkap (Header + Detail) untuk export Excel.
 * Filter sama persis dengan getList (Tanggal, Cabang, Kode Barang).
 */
const exportDetails = async (filters) => {
  const { startDate, endDate, kodeBarang, cabang } = filters;

  let params = [startDate, endDate, cabang];
  let itemFilter = "";

  // Filter Kode Barang (Opsional)
  if (kodeBarang) {
    itemFilter = "AND d.sjd_kode = ?";
    params.push(kodeBarang);
  }

  const query = `
    SELECT 
      h.sj_nomor AS "Nomor SJ",
      h.sj_tanggal AS "Tanggal",
      h.sj_kecab AS "Kode Store",
      g.gdg_nama AS "Nama Store",
      h.sj_mt_nomor AS "No. Minta Barang",
      h.sj_ket AS "Keterangan",
      
      -- Data Detail Item
      d.sjd_kode AS "Kode Barang",
      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS "Nama Barang",
      d.sjd_ukuran AS "Ukuran",
      d.sjd_jumlah AS "Jumlah"

    FROM tdc_sj_hdr h
    INNER JOIN tdc_sj_dtl d ON d.sjd_nomor = h.sj_nomor
    LEFT JOIN retail.tgudang g ON g.gdg_kode = h.sj_kecab
    LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.sjd_kode
    
    WHERE h.sj_peminta = "" 
      AND h.sj_tanggal BETWEEN ? AND ?
      AND h.sj_kecab = ?
      ${itemFilter}
      
    ORDER BY h.sj_tanggal DESC, h.sj_nomor DESC, d.sjd_kode ASC
  `;

  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getDetails,
  remove,
  getRequestStatus,
  submitRequest,
  getPrintData,
  getCabangList,
  exportDetails,
};
