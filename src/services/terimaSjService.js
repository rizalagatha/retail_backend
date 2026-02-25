const pool = require("../config/database");
const { format } = require("date-fns");

/**
 * [FIX] Tambahkan fungsi generator nomor terima SJ (TJ)
 */
const generateNewTjNumber = async (connection, cabang, tanggal) => {
  const date = new Date(tanggal);
  const prefix = `${cabang}.TJ.${format(date, "yyMM")}.`;
  const query = `
        SELECT IFNULL(MAX(RIGHT(tj_nomor, 4)), 0) + 1 AS next_num
        FROM ttrm_sj_hdr 
        WHERE tj_nomor LIKE ?;
    `;
  const [rows] = await connection.query(query, [`${prefix}%`]);
  const nextNumber = rows[0].next_num.toString().padStart(4, "0");
  return `${prefix}${nextNumber}`;
};

/**
 * Mengambil daftar cabang yang bisa diakses user.
 * Logika dari Delphi: KDC bisa lihat semua, cabang lain hanya lihat miliknya.
 */
const getCabangList = async (user) => {
  let query = "";
  const params = [];

  if (user.cabang === "KDC") {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc IN (0, 3) ORDER BY gdg_kode";
  } else {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ? ORDER BY gdg_kode";
    params.push(user.cabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil daftar master Surat Jalan (SJ) untuk diterima.
 */
const getList = async (filters) => {
  const { startDate, endDate, cabang, kodeBarang } = filters;
  let params = [cabang, startDate, endDate];
  let itemFilter = "";

  if (kodeBarang) {
    itemFilter = "AND d.sjd_kode = ?";
    params.push(kodeBarang);
  }

  const query = `
    SELECT DISTINCT
        h.sj_nomor AS Nomor,
        h.sj_tanggal AS Tanggal,
        h.sj_mt_nomor AS NomorMinta,
        h.sj_noterima AS NomorTerima,
        t.tj_tanggal AS TglTerima,
        h.sj_kecab AS Store,
        -- LOGIKA DEADLINE
        CASE 
          WHEN h.sj_kecab IN ('K01','K03','K06','K08') THEN 3
          WHEN h.sj_kecab IN ('K10') THEN 7
          ELSE 5 
        END AS BatasHari,
        
        -- HITUNG SELISIH HARI (Hanya untuk yang belum diterima)
        IF(h.sj_noterima IS NULL OR h.sj_noterima = '', DATEDIFF(CURDATE(), h.sj_tanggal), 0) AS SelisihHari,
        g.gdg_nama AS Nama_Store,
        h.sj_ket AS Keterangan,
        IFNULL(t.tj_closing, "N") AS Closing,
        IFNULL((SELECT inv_nomor FROM tinv_hdr WHERE inv_nomor_so = h.sj_nomor LIMIT 1), "") AS NoInvoice
    FROM tdc_sj_hdr h
    INNER JOIN tdc_sj_dtl d ON d.sjd_nomor = h.sj_nomor
    LEFT JOIN ttrm_sj_hdr t ON t.tj_nomor = h.sj_noterima
    LEFT JOIN tgudang g ON g.gdg_kode = h.sj_kecab
    WHERE h.sj_peminta = ""
        AND h.sj_kecab = ?
        AND h.sj_tanggal BETWEEN ? AND ?
    ${itemFilter}
    ORDER BY h.sj_noterima, h.sj_nomor;
    `;
  const [rows] = await pool.query(query, params);
  return rows.map((row) => {
    let statusDeadline = "AMAN";
    if (!row.NomorTerima) {
      if (row.SelisihHari > row.BatasHari + 1)
        statusDeadline = "EKSEKUSI"; // H+2
      else if (row.SelisihHari > row.BatasHari) statusDeadline = "TERLAMBAT"; // H+1
    }
    return { ...row, StatusDeadline: statusDeadline };
  });
};

/**
 * Mengambil detail item dari sebuah Surat Jalan (SJ).
 */
const getDetails = async (nomor) => {
  const query = `
    SELECT 
        d.sjd_kode AS Kode,
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS Nama,
        d.sjd_ukuran AS Ukuran,
        d.sjd_jumlah AS Jumlah,
        IFNULL(td.tjd_jumlah, 0) AS JumlahTerima
    FROM tdc_sj_dtl d
    INNER JOIN tdc_sj_hdr h ON d.sjd_nomor = h.sj_nomor
    LEFT JOIN tbarangdc a ON a.brg_kode = d.sjd_kode
    -- Join ke detail penerimaan menggunakan sj_noterima dari header
    LEFT JOIN ttrm_sj_dtl td ON td.tjd_nomor = h.sj_noterima 
        AND td.tjd_kode = d.sjd_kode 
        AND td.tjd_ukuran = d.sjd_ukuran
    WHERE d.sjd_nomor = ?
    ORDER BY d.sjd_kode, d.sjd_ukuran;
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

/**
 * Menghapus/Membatalkan penerimaan SJ.
 */
const remove = async (nomorSj, nomorTerima, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Ambil data penerimaan
    const [sjRows] = await connection.query(
      "SELECT tj_closing FROM ttrm_sj_hdr WHERE tj_nomor = ?",
      [nomorTerima],
    );
    if (sjRows.length === 0)
      throw new Error("Nomor penerimaan tidak ditemukan.");
    const sj = sjRows[0];

    // --- PERBAIKAN VALIDASI ---
    const cabangPenerimaan = nomorTerima.substring(0, 3);
    if (sj.tj_closing === "Y")
      throw new Error("Penerimaan sudah di-closing. Tidak bisa dibatalkan.");
    if (cabangPenerimaan !== user.cabang)
      throw new Error(
        "Anda tidak berhak membatalkan penerimaan milik cabang lain.",
      );
    // --- AKHIR PERBAIKAN ---

    // Proses pembatalan
    await connection.query("DELETE FROM ttrm_sj_hdr WHERE tj_nomor = ?", [
      nomorTerima,
    ]);
    await connection.query(
      "UPDATE tdc_sj_hdr SET sj_noterima = NULL WHERE sj_nomor = ?",
      [nomorSj],
    );

    await connection.commit();
    return { message: `Penerimaan untuk SJ ${nomorSj} berhasil dibatalkan.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getExportDetails = async (filters) => {
  const { startDate, endDate, cabang, kodeBarang } = filters;
  let params = [cabang, startDate, endDate];
  let itemFilter = "";

  if (kodeBarang) {
    itemFilter = "AND d.sjd_kode = ?";
    params.push(kodeBarang);
  }

  const query = `
    SELECT 
        h.sj_nomor AS 'Nomor SJ',
        h.sj_tanggal AS 'Tanggal SJ',
        h.sj_noterima AS 'Nomor Terima',
        t.tj_tanggal AS 'Tanggal Terima',
        h.sj_kecab AS 'Kode Store',
        g.gdg_nama AS 'Nama Store',
        d.sjd_kode AS 'Kode Barang',
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS 'Nama Barang',
        d.sjd_ukuran AS 'Ukuran',
        d.sjd_jumlah AS 'Jumlah Kirim'
    FROM tdc_sj_hdr h
    JOIN tdc_sj_dtl d ON h.sj_nomor = d.sjd_nomor
    LEFT JOIN ttrm_sj_hdr t ON t.tj_nomor = h.sj_noterima
    LEFT JOIN tgudang g ON g.gdg_kode = h.sj_kecab
    LEFT JOIN tbarangdc a ON a.brg_kode = d.sjd_kode
    WHERE h.sj_peminta = ""
        AND h.sj_kecab = ?
        AND h.sj_tanggal BETWEEN ? AND ?
        ${itemFilter}
    ORDER BY h.sj_nomor, d.sjd_kode;
    `;

  const [rows] = await pool.query(query, params);
  return rows;
};

const autoReceiveSj = async () => {
  const [expiredSj] = await pool.query(`
    SELECT h.sj_nomor, h.sj_tanggal, h.sj_kecab, h.sj_mt_nomor
    FROM tdc_sj_hdr h
    WHERE (h.sj_noterima IS NULL OR h.sj_noterima = '')
      AND DATEDIFF(CURDATE(), h.sj_tanggal) >= (
        CASE 
          WHEN h.sj_kecab IN ('K01','K03','K06','K08') THEN 5
          WHEN h.sj_kecab = 'K10' THEN 9 
          ELSE 7 
        END
      )
  `);

  for (const sj of expiredSj) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [items] = await connection.query(
        "SELECT sjd_kode, sjd_ukuran, sjd_jumlah FROM tdc_sj_dtl WHERE sjd_nomor = ?",
        [sj.sj_nomor],
      );

      const tjNomor = await generateNewTjNumber(
        connection,
        sj.sj_kecab,
        new Date(),
      );
      const timestamp = format(new Date(), "yyyyMMddHHmmssSSS");
      const idrecHeader = `${sj.sj_kecab}.TJ.${timestamp}`;

      // A. Insert Header (Sesuai DDL: tj_idrec, tj_nomor, tj_tanggal, tj_mt_nomor, tj_cab)
      await connection.query(
        `INSERT INTO ttrm_sj_hdr 
          (tj_idrec, tj_nomor, tj_tanggal, tj_mt_nomor, tj_cab, tj_closing, user_create, date_create)
         VALUES 
          (?, ?, CURDATE(), ?, ?, 'N', 'SYSTEM', NOW())`, // 4 tanda tanya untuk 4 variabel di array
        [idrecHeader, tjNomor, sj.sj_mt_nomor, sj.sj_kecab],
      );

      // B. Insert Detail (Sesuai DDL: tjd_idrec, tjd_iddrec, tjd_nomor)
      const detailValues = items.map((it, idx) => [
        idrecHeader,
        `${idrecHeader}.${idx + 1}`,
        tjNomor,
        it.sjd_kode,
        it.sjd_ukuran,
        it.sjd_jumlah,
      ]);

      await connection.query(
        "INSERT INTO ttrm_sj_dtl (tjd_idrec, tjd_iddrec, tjd_nomor, tjd_kode, tjd_ukuran, tjd_jumlah) VALUES ?",
        [detailValues],
      );

      // C. Update SJ Asal
      await connection.query(
        "UPDATE tdc_sj_hdr SET sj_noterima = ? WHERE sj_nomor = ?",
        [tjNomor, sj.sj_nomor],
      );

      await connection.commit();
      console.log(`[CRON] SUCCESS: SJ ${sj.sj_nomor} -> ${tjNomor}`);
    } catch (error) {
      await connection.rollback();
      console.error(`[CRON] FAILED SJ ${sj.sj_nomor}:`, error.message);
    } finally {
      connection.release();
    }
  }
};

module.exports = {
  getCabangList,
  getList,
  getDetails,
  remove,
  getExportDetails,
  autoReceiveSj,
};
