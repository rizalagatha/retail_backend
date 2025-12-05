const pool = require("../config/database");
const { format } = require("date-fns"); // Pastikan import ini ada di paling atas

/**
 * Menghasilkan nomor Terima SJ (TJ) baru.
 */
const generateNewTjNumber = async (gudang, tanggal) => {
  const date = new Date(tanggal);
  const prefix = `${gudang}.TJ.${format(date, "yyMM")}.`;

  const query = `
        SELECT IFNULL(MAX(RIGHT(tj_nomor, 4)), 0) + 1 AS next_num
        FROM ttrm_sj_hdr 
        WHERE tj_nomor LIKE ?;
    `;
  const [rows] = await pool.query(query, [`${prefix}%`]);
  const nextNumber = rows[0].next_num.toString().padStart(4, "0");

  return `${prefix}${nextNumber}`;
};

/**
 * Memuat data awal untuk form dari Surat Jalan yang dipilih.
 */
const loadInitialData = async (nomorSj) => {
  const headerQuery = `
    SELECT 
        h.sj_nomor, h.sj_tanggal, h.sj_mt_nomor, h.sj_ket AS keterangan,
        h.sj_cab AS gudang_asal_kode,
        g_asal.gdg_nama AS gudang_asal_nama
    FROM tdc_sj_hdr h
    LEFT JOIN tgudang g_asal ON g_asal.gdg_kode = h.sj_cab
    WHERE h.sj_nomor = ?;
    `;
  const [headerRows] = await pool.query(headerQuery, [nomorSj]);
  if (headerRows.length === 0)
    throw new Error("Data Surat Jalan tidak ditemukan.");

  const itemsQuery = `
    SELECT
        d.sjd_kode AS kode,
        b.brgd_barcode AS barcode,
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
        d.sjd_ukuran AS ukuran,
        d.sjd_jumlah AS jumlahKirim
    FROM tdc_sj_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.sjd_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sjd_kode AND b.brgd_ukuran = d.sjd_ukuran
    WHERE d.sjd_nomor = ?
    ORDER BY d.sjd_kode, d.sjd_ukuran;
    `;
  const [items] = await pool.query(itemsQuery, [nomorSj]);

  return { header: headerRows[0], items };
};

/**
 * Menyimpan data Terima SJ.
 */
const saveData = async (payload, user) => {
  const { header, items } = payload;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const nomorSj = header.nomorSj;
    const tanggalTerima = header.tanggalTerima;
    const nomorMinta = header.nomorMinta;

    // Hitung total terima
    const totalTerima = items.reduce(
      (sum, i) => sum + (Number(i.jumlahTerima) || 0),
      0
    );

    // --- 1️⃣ BATAL TERIMA (jika semua jumlahTerima = 0) ---
    if (totalTerima === 0) {
      // Clear nomor terima di SJ (TANPA NULL)
      await connection.query(
        `UPDATE tdc_sj_hdr 
         SET sj_noterima = '' 
         WHERE sj_nomor = ?`,
        [nomorSj]
      );

      // Hapus detail penerimaan
      await connection.query(
        `DELETE d.* 
         FROM ttrm_sj_dtl d
         JOIN ttrm_sj_hdr h ON h.tj_nomor = d.tjd_nomor
         WHERE h.tj_mt_nomor = ? AND h.tj_cab = ?`,
        [nomorMinta, user.cabang]
      );

      // Hapus header penerimaan
      await connection.query(
        `DELETE FROM ttrm_sj_hdr 
         WHERE tj_mt_nomor = ? AND tj_cab = ?`,
        [nomorMinta, user.cabang]
      );

      await connection.commit();
      return { message: "Penerimaan dibatalkan.", nomor: null };
    }

    // --- 2️⃣ CEK APAKAH SUDAH PERNAH TERIMA (EDIT MODE) ---
    const [cekExist] = await connection.query(
      `SELECT tj_nomor, tj_idrec 
       FROM ttrm_sj_hdr 
       WHERE tj_mt_nomor = ? AND tj_cab = ?`,
      [nomorMinta, user.cabang]
    );

    const isEdit = cekExist.length > 0;
    let tjNomor = null;
    let idrec = null;

    // --- 3️⃣ MODE EDIT ---
    if (isEdit) {
      tjNomor = cekExist[0].tj_nomor;
      idrec = cekExist[0].tj_idrec;

      // Hapus detail lama (akan replace)
      await connection.query(`DELETE FROM ttrm_sj_dtl WHERE tjd_nomor = ?`, [
        tjNomor,
      ]);
    } else {
      // --- 4️⃣ MODE INSERT BARU ---
      tjNomor = await generateNewTjNumber(user.cabang, tanggalTerima);

      const timestamp = format(new Date(), "yyyyMMddHHmmssSSS");
      idrec = `${user.cabang}TJ${timestamp}`;

      await connection.query(
        `INSERT INTO ttrm_sj_hdr 
          (tj_idrec, tj_nomor, tj_tanggal, tj_mt_nomor, tj_cab, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [idrec, tjNomor, tanggalTerima, nomorMinta, user.cabang, user.kode]
      );
    }

    // --- 5️⃣ INSERT DETAIL BARU ---
    const detailValues = items
      .filter((i) => i.jumlahTerima > 0)
      .map((it, index) => {
        const nourut = index + 1;
        const iddrec = `${idrec}${nourut}`;
        return [idrec, iddrec, tjNomor, it.kode, it.ukuran, it.jumlahTerima];
      });

    if (detailValues.length > 0) {
      await connection.query(
        `INSERT INTO ttrm_sj_dtl 
          (tjd_idrec, tjd_iddrec, tjd_nomor, tjd_kode, tjd_ukuran, tjd_jumlah)
         VALUES ?`,
        [detailValues]
      );
    }

    // --- 6️⃣ UPDATE SJ HEADER (nomor terima) ---
    // Pakai '' (empty string) bukan NULL!
    await connection.query(
      `UPDATE tdc_sj_hdr 
       SET sj_noterima = ?
       WHERE sj_nomor = ?`,
      [tjNomor, nomorSj]
    );

    await connection.commit();

    return {
      message: isEdit
        ? `Penerimaan SJ ${tjNomor} berhasil diperbarui.`
        : `Penerimaan SJ berhasil disimpan dengan nomor ${tjNomor}.`,
      nomor: tjNomor,
    };
  } catch (error) {
    await connection.rollback();
    console.error("ERROR SAVE TERIMA SJ:", error);
    throw new Error("Gagal menyimpan penerimaan SJ.");
  } finally {
    connection.release();
  }
};

module.exports = {
  loadInitialData,
  saveData,
};
