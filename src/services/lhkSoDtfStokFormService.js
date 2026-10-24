const pool = require("../config/database");
const { format } = require("date-fns");

// Fungsi untuk mencari SO Stok yang valid (dari KeyDown F1)
const searchSoStok = async (filters) => {
  const { cabang, term } = filters;
  const searchTerm = `%${term}%`;
  const query = `
        SELECT * FROM (
            SELECT 
                h.sd_nomor AS nomor,
                h.sd_tanggal AS tanggal,
                h.sd_nama AS nama,
                IFNULL((SELECT SUM(dd.sds_jumlah) FROM tsodtf_stok dd WHERE dd.sds_nomor = h.sd_nomor), 0) AS qtySO,
                IFNULL((SELECT SUM(dd.dsd_jumlah) FROM tdtfstok_dtl dd JOIN tdtfstok_hdr hh ON hh.ds_nomor = dd.dsd_nomor WHERE hh.ds_sd_nomor = h.sd_nomor), 0) AS qtyLhk
            FROM tsodtf_hdr h
            WHERE h.sd_stok = "Y" AND h.sd_alasan = "" AND h.sd_cab = ?
              AND (h.sd_nomor LIKE ? OR h.sd_nama LIKE ?)
        ) x 
        WHERE x.qtyLhk < x.qtySO
        ORDER BY x.tanggal DESC, x.nomor DESC
    `;
  const [rows] = await pool.query(query, [cabang, searchTerm, searchTerm]);
  return rows;
};

// Fungsi untuk mengambil detail SO untuk mengisi grid (dari edtsoExit)
const getSoDetailsForGrid = async (soNomor) => {
  const query = `
        SELECT 
            d.sds_kode AS kode,
            a.brg_warna AS nama,
            d.sds_ukuran AS ukuran,
            d.sds_jumlah AS qtyso,
            IFNULL((SELECT SUM(dd.dsd_jumlah) FROM tdtfstok_dtl dd JOIN tdtfstok_hdr hh ON hh.ds_nomor=dd.dsd_nomor WHERE hh.ds_sd_nomor = d.sds_nomor AND dd.dsd_kode = d.sds_kode AND dd.dsd_ukuran = d.sds_ukuran), 0) AS sudah,
            (d.sds_jumlah - IFNULL((SELECT SUM(dd.dsd_jumlah) FROM tdtfstok_dtl dd JOIN tdtfstok_hdr hh ON hh.ds_nomor=dd.dsd_nomor WHERE hh.ds_sd_nomor = d.sds_nomor AND dd.dsd_kode = d.sds_kode AND dd.dsd_ukuran = d.sds_ukuran), 0)) AS belum
        FROM tsodtf_stok d
        JOIN tbarangdc a ON a.brg_kode = d.sds_kode
        WHERE d.sds_nomor = ?
        ORDER BY d.sds_nourut
    `;
  const [rows] = await pool.query(query, [soNomor]);
  return rows.map((row) => ({ ...row, jumlah: 0 })); // Tambahkan field 'jumlah' untuk inputan user
};

// Fungsi untuk menyimpan data (dari simpandata)
const save = async (data, user) => {
  const { header, items, isNew } = data;
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    if (!isNew) {
      throw new Error(
        "LHK stok yang sudah disimpan tidak bisa diubah. Hubungi admin jika perlu koreksi.",
      );
    }

    let lhkNomor = header.nomor;

    // --- GENERATE IDREC HEADER ---
    // Format: K01DS20251127142859.582
    // Gunakan timestamp saat ini
    const now = new Date();
    const timestampHeader = format(now, "yyyyMMddHHmmss.SSS");

    // Jika Edit, ambil IDREC lama. Jika Baru, buat baru.
    let ds_idrec;
    if (isNew) {
      ds_idrec = `${user.cabang}DS${timestampHeader}`;
    } else {
      const [existing] = await connection.query(
        "SELECT ds_idrec FROM tdtfstok_hdr WHERE ds_nomor = ?",
        [lhkNomor],
      );
      ds_idrec = existing[0]?.ds_idrec || `${user.cabang}DS${timestampHeader}`; // Fallback jika null
    }

    if (isNew) {
      const prefix = `${user.cabang}DS${format(
        new Date(header.tanggal),
        "yyMM",
      )}`;

      // Locking row untuk penomoran
      const [maxRows] = await connection.query(
        `SELECT IFNULL(MAX(CAST(RIGHT(ds_nomor, 5) AS UNSIGNED)), 0) AS maxNum
         FROM tdtfstok_hdr
         WHERE ds_cab = ?
         AND ds_nomor LIKE CONCAT(?, '%')
         FOR UPDATE`, // Tambahkan FOR UPDATE agar aman concurrency
        [user.cabang, prefix],
      );

      const nextNum = parseInt(maxRows[0].maxNum, 10) + 1;
      lhkNomor = `${prefix}${String(100000 + nextNum).slice(1)}`;

      await connection.query(
        `INSERT INTO tdtfstok_hdr 
         (ds_idrec, ds_nomor, ds_tanggal, ds_sd_nomor, ds_cab, user_create, date_create) 
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          ds_idrec,
          lhkNomor,
          header.tanggal,
          header.soNomor,
          user.cabang,
          user.kode,
        ],
      );
    } else {
      await connection.query(
        `UPDATE tdtfstok_hdr 
         SET ds_tanggal = ?, user_modified = ?, date_modified = NOW() 
         WHERE ds_nomor = ?`,
        [header.tanggal, user.kode, lhkNomor],
      );
    }

    // Baris yang sama WAJIB memakai dsd_iddrec yang sama. Trigger tdtfstok_dtl_after_insert
    // memposting stok dengan mst_idrec = dsd_iddrec dan ON DUPLICATE KEY UPDATE, jadi id yang
    // stabil membuat simpan ulang meng-update baris stok yang sama, bukan menambah baris baru.
    const [barisLama] = await connection.query(
      "SELECT dsd_iddrec, dsd_kode, dsd_ukuran FROM tdtfstok_dtl WHERE dsd_nomor = ?",
      [lhkNomor],
    );
    const idLama = new Map(
      barisLama.map((b) => [`${b.dsd_kode}||${b.dsd_ukuran}`, b.dsd_iddrec]),
    );

    // Hapus detail lama
    await connection.query("DELETE FROM tdtfstok_dtl WHERE dsd_nomor = ?", [
      lhkNomor,
    ]);

    const validItems = items.filter((item) => Number(item.jumlah) > 0);
    const idTerpakai = new Set();

    for (const [index, item] of validItems.entries()) {
      const dsd_idrec = ds_idrec;

      let dsd_iddrec = idLama.get(`${item.kode}||${item.ukuran}`);
      if (!dsd_iddrec || idTerpakai.has(dsd_iddrec)) {
        const detailTime = new Date(now.getTime() + index);
        dsd_iddrec = `${user.cabang}DS${format(detailTime, "yyyyMMddHHmmss.SSS")}`;
      }
      idTerpakai.add(dsd_iddrec);

      await connection.query(
        `INSERT INTO tdtfstok_dtl 
         (dsd_idrec, dsd_iddrec, dsd_nomor, dsd_kode, dsd_ukuran, dsd_jumlah) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [dsd_idrec, dsd_iddrec, lhkNomor, item.kode, item.ukuran, item.jumlah],
      );
    }

    // Baris yang dibuang dari LHK: stoknya ikut dinonaktifkan (trigger tidak punya pembalik)
    const idDibuang = barisLama
      .map((b) => b.dsd_iddrec)
      .filter((id) => !idTerpakai.has(id));
    if (idDibuang.length > 0) {
      await connection.query(
        "UPDATE tmasterstok SET mst_aktif = 'N' WHERE mst_idrec IN (?)",
        [idDibuang],
      );
    }

    // Tanggal LHK bisa berubah saat edit; ON DUPLICATE KEY di trigger hanya meng-update qty
    await connection.query(
      "UPDATE tmasterstok SET mst_tanggal = ? WHERE mst_noreferensi = ? AND mst_aktif = 'Y'",
      [header.tanggal, lhkNomor],
    );

    await connection.commit();
    return {
      message: `Data LHK Stok ${lhkNomor} berhasil disimpan.`,
      nomor: lhkNomor,
    };
  } catch (error) {
    await connection.rollback();
    console.error("Save LHK Stok Error:", error);
    throw new Error("Gagal menyimpan data LHK Stok.");
  } finally {
    connection.release();
  }
};

const getSudah = async (connection, soNomor, kode, ukuran, excludeLhkNomor) => {
  const query = `
        SELECT IFNULL(SUM(dsd_jumlah), 0) AS total 
        FROM tdtfstok_dtl
        JOIN tdtfstok_hdr ON ds_nomor = dsd_nomor
        WHERE ds_nomor <> ? AND ds_sd_nomor = ? AND dsd_kode = ? AND dsd_ukuran = ?
    `;
  const [rows] = await connection.query(query, [
    excludeLhkNomor,
    soNomor,
    kode,
    ukuran,
  ]);
  return rows[0].total;
};

// Fungsi untuk memuat data saat mode Ubah
const loadForEdit = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    // 1. Ambil data header
    const [headerRows] = await connection.query(
      "SELECT * FROM tdtfstok_hdr WHERE ds_nomor = ?",
      [nomor],
    );
    if (headerRows.length === 0) {
      throw new Error("Data LHK tidak ditemukan.");
    }
    const header = headerRows[0];

    // 2. Ambil "template" item dari SO Stok terkait (mirip loaddataall bagian pertama)
    const templateQuery = `
            SELECT 
                d.sds_kode AS kode, a.brg_warna AS nama, d.sds_ukuran AS ukuran,
                d.sds_jumlah AS qtyso
            FROM tsodtf_stok d
            JOIN tbarangdc a ON a.brg_kode = d.sds_kode
            WHERE d.sds_nomor = ? ORDER BY d.sds_nourut
        `;
    const [templateItems] = await connection.query(templateQuery, [
      header.ds_sd_nomor,
    ]);

    // 3. Ambil detail LHK yang sudah disimpan
    const [savedDetails] = await connection.query(
      "SELECT * FROM tdtfstok_dtl WHERE dsd_nomor = ?",
      [nomor],
    );

    // 4. Gabungkan data: hitung 'sudah', 'belum', dan isi 'jumlah'
    const items = [];
    for (const item of templateItems) {
      const sudah = await getSudah(
        connection,
        header.ds_sd_nomor,
        item.kode,
        item.ukuran,
        nomor,
      );
      const savedItem = savedDetails.find(
        (d) => d.dsd_kode === item.kode && d.dsd_ukuran === item.ukuran,
      );

      items.push({
        ...item,
        sudah: sudah,
        belum: item.qtyso - sudah,
        jumlah: savedItem ? savedItem.dsd_jumlah : 0,
      });
    }

    return { header, items };
  } finally {
    connection.release();
  }
};

module.exports = {
  searchSoStok,
  getSoDetailsForGrid,
  save,
  loadForEdit,
};
