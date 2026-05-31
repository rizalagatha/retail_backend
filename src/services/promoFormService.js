const pool = require("../config/database");

// ============================================================
// SQL MIGRATION (jalankan sekali di DB):
// ------------------------------------------------------------
// ALTER TABLE tpromo
//   ADD COLUMN pro_basis       ENUM('ALL','KATEGORI','TIPE','ITEM') NOT NULL DEFAULT 'ALL',
//   ADD COLUMN pro_exclude_kata VARCHAR(500) NOT NULL DEFAULT '',
//   ADD COLUMN pro_mode_barang  ENUM('TRIGGER','DISCOUNT') NOT NULL DEFAULT 'TRIGGER',
//   ADD COLUMN pro_no_maps      TINYINT(1) NOT NULL DEFAULT 0;
//
// CREATE TABLE IF NOT EXISTS tpromo_level_exclude (
//   ple_nomor  VARCHAR(20) NOT NULL,
//   ple_level  VARCHAR(5)  NOT NULL,
//   PRIMARY KEY (ple_nomor, ple_level)
// );
// ============================================================

const getInitialData = async () => {
  const [cabang] = await pool.query(
    "SELECT gdg_kode AS cab, false AS berlaku FROM tgudang WHERE gdg_dc=0 ORDER BY gdg_kode",
  );
  const [level] = await pool.query(
    'SELECT level_kode AS kode, level_nama AS level, false AS berlaku FROM tcustomer_level WHERE level_aktif="Y" ORDER BY level_kode',
  );

  // Level exclude list — salinan terpisah agar tidak tercampur dengan "level berlaku"
  const levelExclude = level.map((l) => ({ ...l, berlaku: false }));

  return { cabang, level, levelExclude };
};

const getForEdit = async (nomor) => {
  const [headerRows] = await pool.query(
    `SELECT 
       pro_nomor, pro_judul, pro_tanggal1, pro_tanggal2,
       pro_jenis, pro_totalrp, pro_totalqty,
       pro_disrp, pro_dispersen, pro_rpvoucher,
       pro_lipat, pro_generate, pro_f1,
       pro_jenis_kupon, pro_cetak_kupon,
       pro_keterangan, pro_note,
       -- [BARU]
       pro_basis,
       pro_exclude_kode,
       pro_include_kata,
       pro_mode_barang,
       pro_no_maps,
       pro_no_disc_member
     FROM tpromo
     WHERE pro_nomor = ?`,
    [nomor],
  );
  if (headerRows.length === 0) throw new Error("Data promo tidak ditemukan.");

  const [bonusItems] = await pool.query(
    "SELECT bns_brg_kode AS kode, bns_brg_ukuran AS ukuran, bns_qty AS qty FROM tpromo_bonus WHERE bns_nomor = ?",
    [nomor],
  );

  const [cabangBerlaku] = await pool.query(
    "SELECT pc_cab FROM tpromo_cabang WHERE pc_nomor = ?",
    [nomor],
  );

  const [levelBerlaku] = await pool.query(
    "SELECT pl_level FROM tpromo_level WHERE pl_nomor = ?",
    [nomor],
  );

  // [BARU] Level yang DIKECUALIKAN dari promo ini
  const [levelExcludeRows] = await pool.query(
    "SELECT ple_level FROM tpromo_level_exclude WHERE ple_nomor = ?",
    [nomor],
  );

  const [applicableItems] = await pool.query(
    `SELECT 
      p.pb_brg_kode AS kode,
      TRIM(CONCAT(
        a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",
        a.brg_jeniskain," ",a.brg_warna
      )) AS nama,
      p.pb_ukuran AS ukuran,
      p.pb_qty    AS qty,
      p.pb_harga  AS harga,
      p.pb_disc   AS disc,
      p.pb_diskon AS diskon
    FROM tpromo_barang p
    LEFT JOIN tbarangdc a ON a.brg_kode = p.pb_brg_kode
    WHERE p.pb_nomor = ?
    LIMIT 10`,
    [nomor],
  );

  const [countResult] = await pool.query(
    "SELECT COUNT(*) as total FROM tpromo_barang WHERE pb_nomor = ?",
    [nomor],
  );

  return {
    header: headerRows[0],
    applicableItems,
    applicableItemsCount: countResult[0].total,
    bonusItems,
    cabangBerlaku: cabangBerlaku.map((c) => c.pc_cab),
    levelBerlaku: levelBerlaku.map((l) => l.pl_level),
    // [BARU]
    levelExclude: levelExcludeRows.map((l) => l.ple_level),
  };
};

const save = async (payload, user) => {
  const {
    header,
    applicableItems,
    bonusItems,
    cabang,
    level,
    levelExclude, // [BARU] array kode level yang dikecualikan
    isNew,
  } = payload;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // ── 1. Nomor dokumen ─────────────────────────────────
    let nomorDokumen = header.nomor;
    if (isNew) {
      const year = new Date().getFullYear().toString();
      const [rows] = await connection.query(
        `SELECT IFNULL(MAX(RIGHT(pro_nomor, 3)), 0) + 1 AS next_num
         FROM tpromo WHERE MID(pro_nomor, 5, 4) = ?`,
        [year],
      );
      nomorDokumen = `PRO-${year}-${rows[0].next_num.toString().padStart(3, "0")}`;
    }

    // ── 2. Header ────────────────────────────────────────
    // [BARU] kolom: pro_basis, pro_exclude_kata, pro_mode_barang, pro_no_maps
    if (isNew) {
      await connection.query(
        `INSERT INTO tpromo (
           pro_nomor, pro_judul, pro_tanggal1, pro_tanggal2,
           pro_jenis, pro_totalrp, pro_totalqty,
           pro_disrp, pro_dispersen, pro_rpvoucher,
           pro_lipat, pro_generate, pro_f1,
           pro_jenis_kupon, pro_cetak_kupon,
           pro_keterangan, pro_note,
           pro_basis, pro_exclude_kode, pro_include_kata, pro_mode_barang, pro_no_maps, pro_no_disc_member,
           user_create, date_create
         ) VALUES (
           ?, ?, ?, ?,
           ?, ?, ?,
           ?, ?, ?,
           ?, ?, ?,
           ?, ?,
           ?, ?,
           ?, ?, ?, ?, ?, ?,
           ?, NOW()
         )`,
        [
          nomorDokumen,
          header.judul,
          header.tanggal1,
          header.tanggal2,
          header.jenis,
          header.totalRp || 0,
          header.totalQty || 0,
          header.diskonRp || 0,
          header.diskonPersen || 0,
          header.rpVoucher || 0,
          header.kelipatan,
          header.generate,
          header.f1,
          header.jenisKupon || "",
          header.cetakKupon || "N",
          header.keterangan || "",
          header.note || "",
          // [BARU]
          header.basis || "ALL",
          header.excludeKode || "",
          header.includeKata || "",
          header.modeBarang || "TRIGGER",
          header.noMaps ? 1 : 0,
          header.noDiscMember ? 1 : 0,
          user.kode,
        ],
      );
    } else {
      await connection.query(
        `UPDATE tpromo SET
           pro_judul=?, pro_tanggal1=?, pro_tanggal2=?,
           pro_jenis=?, pro_totalrp=?, pro_totalqty=?,
           pro_disrp=?, pro_dispersen=?, pro_rpvoucher=?,
           pro_lipat=?, pro_generate=?, pro_f1=?,
           pro_jenis_kupon=?, pro_cetak_kupon=?,
           pro_keterangan=?, pro_note=?,
           pro_basis=?, pro_exclude_kode=?, pro_include_kata=?, pro_mode_barang=?, pro_no_maps=?, pro_no_disc_member=?,
           user_modified=?, date_modified=NOW()
         WHERE pro_nomor=?`,
        [
          header.judul,
          header.tanggal1,
          header.tanggal2,
          header.jenis,
          header.totalRp || 0,
          header.totalQty || 0,
          header.diskonRp || 0,
          header.diskonPersen || 0,
          header.rpVoucher || 0,
          header.kelipatan,
          header.generate,
          header.f1,
          header.jenisKupon || "",
          header.cetakKupon || "N",
          header.keterangan || "",
          header.note || "",
          // [BARU]
          header.basis || "ALL",
          header.excludeKode || "",
          header.includeKata || "",
          header.modeBarang || "TRIGGER",
          header.noMaps ? 1 : 0,
          header.noDiscMember ? 1 : 0,
          user.kode,
          nomorDokumen,
        ],
      );
    }

    // ── 3. Bonus Items ───────────────────────────────────
    await connection.query("DELETE FROM tpromo_bonus WHERE bns_nomor = ?", [
      nomorDokumen,
    ]);
    if (Array.isArray(bonusItems) && bonusItems.length > 0) {
      const vals = bonusItems.map((b) => [
        nomorDokumen,
        b.kode,
        b.ukuran,
        b.qty,
      ]);
      await connection.query(
        "INSERT INTO tpromo_bonus (bns_nomor, bns_brg_kode, bns_brg_ukuran, bns_qty) VALUES ?",
        [vals],
      );
    }

    // ── 4. Cabang Berlaku ────────────────────────────────
    await connection.query("DELETE FROM tpromo_cabang WHERE pc_nomor = ?", [
      nomorDokumen,
    ]);
    if (Array.isArray(cabang) && cabang.length > 0) {
      const vals = cabang.map((c) => [nomorDokumen, c]);
      await connection.query(
        "INSERT INTO tpromo_cabang (pc_nomor, pc_cab) VALUES ?",
        [vals],
      );
    }

    // ── 5. Level Berlaku ─────────────────────────────────
    await connection.query("DELETE FROM tpromo_level WHERE pl_nomor = ?", [
      nomorDokumen,
    ]);
    if (Array.isArray(level) && level.length > 0) {
      const vals = level.map((l) => [nomorDokumen, l]);
      await connection.query(
        "INSERT INTO tpromo_level (pl_nomor, pl_level) VALUES ?",
        [vals],
      );
    }

    // ── 6. [BARU] Level Dikecualikan ─────────────────────
    await connection.query(
      "DELETE FROM tpromo_level_exclude WHERE ple_nomor = ?",
      [nomorDokumen],
    );
    if (Array.isArray(levelExclude) && levelExclude.length > 0) {
      const vals = levelExclude.map((l) => [nomorDokumen, l]);
      await connection.query(
        "INSERT INTO tpromo_level_exclude (ple_nomor, ple_level) VALUES ?",
        [vals],
      );
    }

    // ── 7. Applicable Items ──────────────────────────────
    if (Array.isArray(applicableItems) && applicableItems.length > 0) {
      await connection.query("DELETE FROM tpromo_barang WHERE pb_nomor = ?", [
        nomorDokumen,
      ]);
      const vals = applicableItems.map((item) => [
        nomorDokumen,
        item.kode,
        item.ukuran,
        item.qty || 0,
        item.harga || 0,
        item.disc || 0,
        item.diskon || 0,
      ]);
      await connection.query(
        `INSERT INTO tpromo_barang
           (pb_nomor, pb_brg_kode, pb_ukuran, pb_qty, pb_harga, pb_disc, pb_diskon)
         VALUES ?`,
        [vals],
      );
    } else if (applicableItems === null) {
      // null = tidak ada perubahan, biarkan data lama
    }

    await connection.commit();
    return {
      message: `Promo berhasil disimpan dengan nomor ${nomorDokumen}`,
      nomor: nomorDokumen,
    };
  } catch (error) {
    await connection.rollback();
    console.error("[ERROR SAVE PROMO]", error);
    throw error;
  } finally {
    connection.release();
  }
};

const lookupProducts = async (filters) => {
  const { term, page, itemsPerPage, gudang } = filters;
  const pageNum = parseInt(page, 10) || 1;
  const limit = parseInt(itemsPerPage, 10);
  const safeLimit = limit <= 0 ? 10 : limit; // fallback jika -1
  const offset = (pageNum - 1) * limit;
  const searchTerm = term ? `%${term}%` : null;

  let whereClause =
    'WHERE a.brg_aktif = 0 AND a.brg_logstok = "Y" AND a.brg_kelompok = ""';
  let params = [];

  if (term) {
    whereClause += ` AND (
      b.brgd_barcode LIKE ? OR
      b.brgd_kode    LIKE ? OR
      TRIM(CONCAT(
        a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan,
        " ", a.brg_jeniskain, " ", a.brg_warna
      )) LIKE ?
    )`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  const countQuery = `
    SELECT COUNT(*) as total
    FROM tbarangdc_dtl b
    INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
    ${whereClause}
  `;
  const [countRows] = await pool.query(countQuery, params);

  const dataQuery = `
    SELECT
      b.brgd_barcode AS barcode,
      b.brgd_kode    AS kode,
      TRIM(CONCAT(
        a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan,
        " ", a.brg_jeniskain, " ", a.brg_warna
      )) AS nama,
      b.brgd_ukuran AS ukuran,
      b.brgd_harga  AS harga,
      CONCAT(b.brgd_kode, '-', b.brgd_ukuran) AS uniqueId
    FROM tbarangdc_dtl b
    INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
    ${whereClause}
    ORDER BY nama, b.brgd_ukuran
    LIMIT ? OFFSET ?
  `;
  const [items] = await pool.query(dataQuery, [...params, limit, offset]);
  return { items, total: countRows[0].total };
};

const getApplicableItemsPaginated = async (
  nomor,
  page = 1,
  itemsPerPage = 10,
) => {
  const [countResult] = await pool.query(
    "SELECT COUNT(*) as total FROM tpromo_barang WHERE pb_nomor = ?",
    [nomor],
  );
  const total = countResult[0].total;

  // [FIX] -1 = tampilkan semua (Vuetify "All")
  const limit = itemsPerPage === -1 ? total : parseInt(itemsPerPage, 10);
  const offset = itemsPerPage === -1 ? 0 : (parseInt(page, 10) - 1) * limit;

  const [items] = await pool.query(
    `SELECT
       p.pb_brg_kode AS kode,
       TRIM(CONCAT(
         a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan,
         " ",a.brg_jeniskain," ",a.brg_warna
       )) AS nama,
       p.pb_ukuran AS ukuran,
       p.pb_qty    AS qty,
       p.pb_harga  AS harga,
       p.pb_disc   AS disc,
       p.pb_diskon AS diskon
     FROM tpromo_barang p
     LEFT JOIN tbarangdc a ON a.brg_kode = p.pb_brg_kode
     WHERE p.pb_nomor = ?
     LIMIT ? OFFSET ?`,
    [nomor, limit, offset],
  );

  return { items, total, page, itemsPerPage };
};

module.exports = {
  getInitialData,
  getForEdit,
  save,
  lookupProducts,
  getApplicableItemsPaginated,
};
