const pool = require("../config/database");

const getInitialData = async () => {
  // Mengambil data awal untuk mengisi grid cabang dan level
  const [cabang] = await pool.query(
    "SELECT gdg_kode AS cab, false AS berlaku FROM tgudang WHERE gdg_dc=0 ORDER BY gdg_kode"
  );
  const [level] = await pool.query(
    'SELECT level_kode AS kode, level_nama AS level, false AS berlaku FROM tcustomer_level WHERE level_aktif="Y" ORDER BY level_kode'
  );
  return { cabang, level };
};

const getForEdit = async (nomor) => {
  const [headerRows] = await pool.query(
    "SELECT * FROM tpromo WHERE pro_nomor = ?",
    [nomor]
  );
  if (headerRows.length === 0) throw new Error("Data promo tidak ditemukan.");

  const [bonusItems] = await pool.query(
    "SELECT bns_brg_kode AS kode, bns_brg_ukuran AS ukuran, bns_qty AS qty FROM tpromo_bonus WHERE bns_nomor = ?",
    [nomor]
  );
  const [cabangBerlaku] = await pool.query(
    "SELECT pc_cab FROM tpromo_cabang WHERE pc_nomor = ?",
    [nomor]
  );
  const [levelBerlaku] = await pool.query(
    "SELECT pl_level FROM tpromo_level WHERE pl_nomor = ?",
    [nomor]
  );

  const [applicableItems] = await pool.query(
    `SELECT 
      p.pb_brg_kode AS kode,
      TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
      p.pb_ukuran AS ukuran, p.pb_qty AS qty, p.pb_harga AS harga, p.pb_disc AS disc, p.pb_diskon AS diskon 
    FROM tpromo_barang p
    LEFT JOIN tbarangdc a ON a.brg_kode = p.pb_brg_kode
    WHERE p.pb_nomor = ?
    LIMIT 10`, // [TAMBAH] Limit awal untuk load pertama
    [nomor]
  );

  const [countResult] = await pool.query(
    `SELECT COUNT(*) as total FROM tpromo_barang WHERE pb_nomor = ?`,
    [nomor]
  );

  return {
    header: headerRows[0],
    applicableItems,
    applicableItemsCount: countResult[0].total, // [TAMBAH]
    bonusItems,
    cabangBerlaku: cabangBerlaku.map((c) => c.pc_cab),
    levelBerlaku: levelBerlaku.map((l) => l.pl_level),
  };
};

const save = async (payload, user) => {
  const { header, applicableItems, bonusItems, cabang, level, isNew } = payload;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // --- 1️⃣ Buat / ambil nomor promo ---
    let nomorDokumen = header.nomor;
    if (isNew) {
      const year = new Date().getFullYear().toString();
      const [rows] = await connection.query(
        `SELECT IFNULL(MAX(RIGHT(pro_nomor, 3)), 0) + 1 AS next_num 
         FROM tpromo WHERE MID(pro_nomor, 5, 4) = ?`,
        [year]
      );
      nomorDokumen = `PRO-${year}-${rows[0].next_num
        .toString()
        .padStart(3, "0")}`;
    }

    // --- 2️⃣ Simpan header ---
    const promoData = [
      nomorDokumen,
      header.judul,
      header.tanggal1,
      header.tanggal2,
      header.jenis,
      header.totalRp,
      header.totalQty,
      header.diskonRp,
      header.diskonPersen,
      header.rpVoucher,
      header.kelipatan,
      header.generate,
      header.f1,
      header.jenisKupon,
      header.cetakKupon,
      header.keterangan,
      header.note,
      user.kode,
    ];

    if (isNew) {
      await connection.query(
        `INSERT INTO tpromo 
         (pro_nomor, pro_judul, pro_tanggal1, pro_tanggal2, pro_jenis, pro_totalrp, pro_totalqty, 
          pro_disrp, pro_dispersen, pro_rpvoucher, pro_lipat, pro_generate, pro_f1, 
          pro_jenis_kupon, pro_cetak_kupon, pro_keterangan, pro_note, user_create, date_create) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        promoData
      );
    } else {
      promoData.shift(); // hapus nomor dari awal
      promoData.push(nomorDokumen);
      await connection.query(
        `UPDATE tpromo 
         SET pro_judul=?, pro_tanggal1=?, pro_tanggal2=?, pro_jenis=?, pro_totalrp=?, pro_totalqty=?, 
             pro_disrp=?, pro_dispersen=?, pro_rpvoucher=?, pro_lipat=?, pro_generate=?, pro_f1=?, 
             pro_jenis_kupon=?, pro_cetak_kupon=?, pro_keterangan=?, pro_note=?, 
             user_modified=?, date_modified=NOW()
         WHERE pro_nomor = ?`,
        promoData
      );
    }

    // --- 3️⃣ Simpan Bonus Items ---
    await connection.query("DELETE FROM tpromo_bonus WHERE bns_nomor = ?", [
      nomorDokumen,
    ]);
    if (Array.isArray(bonusItems) && bonusItems.length > 0) {
      const bonusValues = bonusItems.map((b) => [
        nomorDokumen,
        b.kode,
        b.ukuran,
        b.qty,
      ]);
      await connection.query(
        "INSERT INTO tpromo_bonus (bns_nomor, bns_brg_kode, bns_brg_ukuran, bns_qty) VALUES ?",
        [bonusValues]
      );
    }

    // --- 4️⃣ Simpan Cabang Berlaku ---
    await connection.query("DELETE FROM tpromo_cabang WHERE pc_nomor = ?", [
      nomorDokumen,
    ]);
    if (Array.isArray(cabang) && cabang.length > 0) {
      const cabangValues = cabang.map((c) => [nomorDokumen, c]);
      await connection.query(
        "INSERT INTO tpromo_cabang (pc_nomor, pc_cab) VALUES ?",
        [cabangValues]
      );
    }

    // --- 5️⃣ Simpan Level Berlaku ---
    await connection.query("DELETE FROM tpromo_level WHERE pl_nomor = ?", [
      nomorDokumen,
    ]);
    if (Array.isArray(level) && level.length > 0) {
      const levelValues = level.map((l) => [nomorDokumen, l]);
      await connection.query(
        "INSERT INTO tpromo_level (pl_nomor, pl_level) VALUES ?",
        [levelValues]
      );
    }

    // --- 6️⃣ Simpan Applicable Items (AMAN untuk edit) ---
    if (Array.isArray(applicableItems) && applicableItems.length > 0) {
      // Kalau dikirim array berarti ada perubahan — replace semua data
      await connection.query("DELETE FROM tpromo_barang WHERE pb_nomor = ?", [
        nomorDokumen,
      ]);

      const applicableValues = applicableItems.map((item) => [
        nomorDokumen,
        item.kode,
        item.ukuran,
        item.qty,
        item.harga,
        item.disc,
        item.diskon,
      ]);

      await connection.query(
        `INSERT INTO tpromo_barang 
         (pb_nomor, pb_brg_kode, pb_ukuran, pb_qty, pb_harga, pb_disc, pb_diskon) 
         VALUES ?`,
        [applicableValues]
      );
    } else if (applicableItems === null) {
      // Tidak ada perubahan di applicableItems — biarkan data lama tetap ada
      console.log(
        `[PROMO SAVE] Applicable items tidak berubah → skip update barang.`
      );
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
  const limit = parseInt(itemsPerPage, 10) || 10;
  const offset = (pageNum - 1) * limit;
  const searchTerm = term ? `%${term}%` : null;

  let whereClause =
    'WHERE a.brg_aktif = 0 AND a.brg_logstok = "Y" AND a.brg_kelompok = ""';
  let params = [];

  if (term) {
    whereClause += ` AND (b.brgd_barcode LIKE ? OR b.brgd_kode LIKE ? OR TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) LIKE ?)`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  const countQuery = `SELECT COUNT(*) as total FROM tbarangdc_dtl b INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode ${whereClause}`;
  const [countRows] = await pool.query(countQuery, params);

  const dataQuery = `
        SELECT
            b.brgd_barcode AS barcode, b.brgd_kode AS kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran, b.brgd_harga AS harga,
            CONCAT(b.brgd_kode, '-', b.brgd_ukuran) AS uniqueId
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
        ${whereClause}
        ORDER BY nama, b.brgd_ukuran LIMIT ? OFFSET ?
    `;
  const dataParams = [...params, limit, offset];

  const [items] = await pool.query(dataQuery, dataParams);
  return { items, total: countRows[0].total };
};

const getApplicableItemsPaginated = async (
  nomor,
  page = 1,
  itemsPerPage = 10
) => {
  const offset = (page - 1) * itemsPerPage;

  // Query untuk count total
  const [countResult] = await pool.query(
    `SELECT COUNT(*) as total FROM tpromo_barang WHERE pb_nomor = ?`,
    [nomor]
  );

  // Query untuk data dengan pagination
  const [items] = await pool.query(
    `SELECT 
      p.pb_brg_kode AS kode,
      TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
      p.pb_ukuran AS ukuran, 
      p.pb_qty AS qty, 
      p.pb_harga AS harga, 
      p.pb_disc AS disc, 
      p.pb_diskon AS diskon 
    FROM tpromo_barang p
    LEFT JOIN tbarangdc a ON a.brg_kode = p.pb_brg_kode
    WHERE p.pb_nomor = ?
    LIMIT ? OFFSET ?`,
    [nomor, itemsPerPage, offset]
  );

  return {
    items,
    total: countResult[0].total,
    page,
    itemsPerPage,
  };
};

module.exports = {
  getInitialData,
  getForEdit,
  save,
  lookupProducts,
  getApplicableItemsPaginated, // [TAMBAH] Export fungsi baru
};
