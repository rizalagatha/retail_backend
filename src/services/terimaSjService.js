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
  const { startDate, endDate, cabang, kodeBarang, source } = filters;

  // ── SJ DC ──────────────────────────────────────────
  const dcParams = [cabang, startDate, endDate];
  let dcItemFilter = "";
  if (kodeBarang) {
    dcItemFilter = "AND d.sjd_kode = ?";
    dcParams.push(kodeBarang);
  }

  const dcQuery = `
    SELECT DISTINCT
      h.sj_nomor          AS Nomor,
      h.sj_tanggal        AS Tanggal,
      h.sj_mt_nomor       AS NomorMinta,
      h.sj_noterima       AS NomorTerima,
      t.tj_tanggal        AS TglTerima,
      h.sj_kecab          AS Store,
      g.gdg_nama          AS Nama_Store,
      h.sj_ket            AS Keterangan,
      IFNULL(t.tj_closing,'N') AS Closing,
      IFNULL((
        SELECT inv_nomor FROM tinv_hdr 
        WHERE inv_nomor_so = h.sj_nomor LIMIT 1
      ), '') AS NoInvoice,
      'DC'                AS Source,
      CASE 
        WHEN h.sj_kecab IN ('K01','K03','K06','K08') THEN 3
        WHEN h.sj_kecab IN ('K10') THEN 7
        ELSE 5 
      END AS BatasHari,
      IF(h.sj_noterima IS NULL OR h.sj_noterima = '',
        DATEDIFF(CURDATE(), h.sj_tanggal), 0) AS SelisihHari
    FROM tdc_sj_hdr h
    INNER JOIN tdc_sj_dtl d ON d.sjd_nomor = h.sj_nomor
    LEFT JOIN ttrm_sj_hdr t ON t.tj_nomor = h.sj_noterima
    LEFT JOIN tgudang g ON g.gdg_kode = h.sj_kecab
    WHERE h.sj_peminta = ''
      AND h.sj_kecab = ?
      AND h.sj_tanggal BETWEEN ? AND ?
      ${dcItemFilter}
  `;

  // ── SJ Workshop ────────────────────────────────────
  const wkParams = [cabang, startDate, endDate];
  let wkItemFilter = "";
  if (kodeBarang) {
    wkItemFilter = "AND d.sjwd_kode = ?";
    wkParams.push(kodeBarang);
  }

  const wkQuery = `
    SELECT DISTINCT
      h.sjw_nomor         AS Nomor,
      h.sjw_tanggal       AS Tanggal,
      h.sjw_so_nomor      AS NomorMinta,
      t.tj_nomor          AS NomorTerima,
      t.tj_tanggal        AS TglTerima,
      h.sjw_tujuan_cab    AS Store,
      g.gdg_nama          AS Nama_Store,
      h.sjw_ket           AS Keterangan,
      IFNULL(t.tj_closing,'N') AS Closing,
      ''                  AS NoInvoice,
      'WORKSHOP'          AS Source,
      3                   AS BatasHari,
      IF(t.tj_nomor IS NULL,
        DATEDIFF(CURDATE(), h.sjw_tanggal), 0) AS SelisihHari
    FROM tsj_workshop_hdr h
    INNER JOIN tsj_workshop_dtl d ON d.sjwd_nomor = h.sjw_nomor
    LEFT JOIN ttrm_sj_hdr t ON t.tj_sj_workshop = h.sjw_nomor
    LEFT JOIN tgudang g ON g.gdg_kode = h.sjw_tujuan_cab
    WHERE h.sjw_tujuan_cab = ?
      AND h.sjw_tanggal BETWEEN ? AND ?
      ${wkItemFilter}
  `;

  // ── Gabungkan & filter source ───────────────────────
  let rows = [];

  if (!source || source === "ALL") {
    const [dcRows] = await pool.query(dcQuery, dcParams);
    const [wkRows] = await pool.query(wkQuery, wkParams);
    rows = [...dcRows, ...wkRows];
  } else if (source === "DC") {
    const [dcRows] = await pool.query(dcQuery, dcParams);
    rows = dcRows;
  } else if (source === "WORKSHOP") {
    const [wkRows] = await pool.query(wkQuery, wkParams);
    rows = wkRows;
  }

  // Sort: belum diterima dulu, lalu nomor DESC
  rows.sort((a, b) => {
    if (!a.NomorTerima && b.NomorTerima) return -1;
    if (a.NomorTerima && !b.NomorTerima) return 1;
    return a.Nomor > b.Nomor ? -1 : 1;
  });

  return rows.map((row) => {
    let statusDeadline = "AMAN";
    if (!row.NomorTerima) {
      if (row.SelisihHari > row.BatasHari + 1) statusDeadline = "EKSEKUSI";
      else if (row.SelisihHari > row.BatasHari) statusDeadline = "TERLAMBAT";
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

/**
 * Mengambil informasi tracking komprehensif Surat Jalan (DC / Workshop)
 * Menggabungkan info:
 * 1. Surat Jalan Header (Nomor, Tanggal, Jam, User Buat, Store Tujuan, No. Minta, Packing List, Invoice)
 * 2. Manifest Pengiriman (Nomor Manifest, Tanggal, Jam, Status, Driver, Plat, Ekspedisi, Resi, TTD Driver/Pengirim)
 * 3. Penerimaan Toko (Nomor Terima TJ, Tanggal Terima, Jam, Closing, User Penerima)
 */
const getTracking = async (nomor) => {
  // 1. Coba cari di tdc_sj_hdr (DC)
  const dcQuery = `
    SELECT 
      h.sj_nomor AS sjNomor,
      h.sj_tanggal AS sjTanggal,
      h.sj_mt_nomor AS noMinta,
      h.sj_manifest_nomor AS manifestNomor,
      h.sj_noterima AS noTerima,
      h.sj_kecab AS storeKode,
      g.gdg_nama AS storeNama,
      h.sj_ket AS keterangan,
      h.user_create AS userCreateSj,
      h.date_create AS dateCreateSj,
      'DC' AS source,
      (SELECT GROUP_CONCAT(DISTINCT pl_nomor SEPARATOR ', ') FROM tpacking_list_hdr WHERE pl_sj_nomor = h.sj_nomor) AS noPackingList,
      (SELECT inv_nomor FROM tinv_hdr WHERE inv_nomor_so = h.sj_nomor LIMIT 1) AS noInvoice
    FROM tdc_sj_hdr h
    LEFT JOIN tgudang g ON g.gdg_kode = h.sj_kecab
    WHERE h.sj_nomor = ?;
  `;

  let [rows] = await pool.query(dcQuery, [nomor]);
  let isWorkshop = false;

  if (rows.length === 0) {
    // 2. Coba cari di tsj_workshop_hdr (Workshop)
    const wkQuery = `
      SELECT 
        h.sjw_nomor AS sjNomor,
        h.sjw_tanggal AS sjTanggal,
        h.sjw_so_nomor AS noMinta,
        t.tj_nomor AS noTerima,
        h.sjw_tujuan_cab AS storeKode,
        g.gdg_nama AS storeNama,
        h.sjw_ket AS keterangan,
        h.user_create AS userCreateSj,
        h.date_create AS dateCreateSj,
        'WORKSHOP' AS source,
        '' AS manifestNomor,
        '' AS noPackingList,
        '' AS noInvoice
      FROM tsj_workshop_hdr h
      LEFT JOIN tgudang g ON g.gdg_kode = h.sjw_tujuan_cab
      LEFT JOIN ttrm_sj_hdr t ON t.tj_sj_workshop = h.sjw_nomor
      WHERE h.sjw_nomor = ?;
    `;
    [rows] = await pool.query(wkQuery, [nomor]);
    if (rows.length === 0) {
      throw new Error(`Surat Jalan ${nomor} tidak ditemukan.`);
    }
    isWorkshop = true;
  }

  const sjInfo = rows[0];

  // Ambil Data Manifest jika ada (cek header SJ atau detail manifest)
  let manifestNomor = sjInfo.manifestNomor;
  if (!manifestNomor) {
    const [dtlRows] = await pool.query(
      "SELECT mpd_nomor FROM tmanifest_pengiriman_dtl WHERE mpd_sj_nomor = ? LIMIT 1",
      [nomor],
    );
    if (dtlRows.length > 0) {
      manifestNomor = dtlRows[0].mpd_nomor;
      sjInfo.manifestNomor = manifestNomor;
    }
  }

  let manifestInfo = null;
  if (manifestNomor) {
    const mpQuery = `
      SELECT 
        m.mp_nomor AS manifestNomor,
        m.mp_tanggal AS manifestTanggal,
        m.mp_jam AS manifestJam,
        m.mp_gudang AS gudangAsal,
        ga.gdg_nama AS namaGudangAsal,
        m.mp_tujuan AS gudangTujuan,
        gt.gdg_nama AS namaGudangTujuan,
        m.mp_status AS manifestStatus,
        m.mp_jenis_kirim AS jenisKirim,
        m.mp_driver AS driver,
        m.mp_plat_nomor AS platNomor,
        m.mp_ekspedisi AS ekspedisi,
        m.mp_no_resi AS noResi,
        m.mp_total_sj AS totalSj,
        m.mp_total_koli AS totalKoli,
        m.mp_total_qty AS totalQty,
        m.mp_berat_kg AS beratKg,
        m.mp_ket AS keterangan,
        CASE WHEN m.mp_ttd_pengirim IS NOT NULL AND m.mp_ttd_pengirim != '' THEN 1 ELSE 0 END AS hasTtdPengirim,
        CASE WHEN m.mp_ttd_driver IS NOT NULL AND m.mp_ttd_driver != '' THEN 1 ELSE 0 END AS hasTtdDriver,
        m.user_create AS userCreateManifest,
        m.date_create AS dateCreateManifest,
        m.user_modified AS userModifiedManifest,
        m.date_modified AS dateModifiedManifest
      FROM tmanifest_pengiriman_hdr m
      LEFT JOIN tgudang ga ON ga.gdg_kode = m.mp_gudang
      LEFT JOIN tgudang gt ON gt.gdg_kode = m.mp_tujuan
      WHERE m.mp_nomor = ?;
    `;
    const [mpRows] = await pool.query(mpQuery, [manifestNomor]);
    if (mpRows.length > 0) {
      manifestInfo = mpRows[0];
    }
  }

  // Ambil Data Penerimaan (TJ) jika ada
  let terimaInfo = null;
  const noTerima = sjInfo.noTerima;
  if (noTerima) {
    const tjQuery = `
      SELECT 
        t.tj_nomor AS noTerima,
        t.tj_tanggal AS tanggalTerima,
        t.tj_closing AS closing,
        t.user_create AS userTerima,
        t.date_create AS dateCreateTerima
      FROM ttrm_sj_hdr t
      WHERE t.tj_nomor = ?;
    `;
    const [tjRows] = await pool.query(tjQuery, [noTerima]);
    if (tjRows.length > 0) {
      terimaInfo = tjRows[0];
    }
  }

  // Tentukan Status Manifest Saat Ini:
  // 1. DRAFT: Manifest Dibuat (Draft)
  // 2. DIKIRIM: Manifest Dikirim
  // 3. DITERIMA: Manifest Diterima (Penerimaan Store dengan No. Terima)
  let currentStatus = "BELUM_MANIFEST";
  if (terimaInfo?.noTerima || sjInfo.noTerima) {
    currentStatus = "DITERIMA";
  } else if (manifestInfo?.manifestStatus === "DIKIRIM") {
    currentStatus = "DIKIRIM";
  } else if (manifestInfo?.manifestNomor) {
    currentStatus = "DRAFT";
  } else {
    currentStatus = "BELUM_MANIFEST";
  }

  return {
    sj: sjInfo,
    manifest: manifestInfo,
    terima: terimaInfo,
    currentStatus,
    isWorkshop,
  };
};

module.exports = {
  getCabangList,
  getList,
  getDetails,
  remove,
  getExportDetails,
  autoReceiveSj,
  getTracking,
};
