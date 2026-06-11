const pool = require("../config/database");
const { format } = require("date-fns"); // Pastikan import ini ada di paling atas

/**
 * Menghasilkan nomor Terima SJ (TJ) baru.
 */
const generateNewTjNumber = async (connection, gudang, tanggal) => {
  if (!gudang) {
    throw new Error(
      "FATAL: Kode Cabang (user.cabang) tidak terbaca/undefined!",
    );
  }

  const date = new Date(tanggal);
  const prefix = `${gudang}.TJ.${format(date, "yyMM")}.`;

  // Query dengan CAST agar aman
  const query = `
        SELECT IFNULL(MAX(CAST(RIGHT(tj_nomor, 4) AS UNSIGNED)), 0) + 1 AS next_num
        FROM ttrm_sj_hdr 
        WHERE tj_nomor LIKE ?
    `;

  // Gunakan connection transaction yang dilempar
  const [rows] = await connection.query(query, [`${prefix}%`]);

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

const loadInitialDataWorkshop = async (nomorSjw) => {
  const headerQuery = `
    SELECT 
      h.sjw_nomor                    AS sj_nomor,
      h.sjw_tanggal                  AS sj_tanggal,
      h.sjw_so_nomor                 AS sj_mt_nomor,
      h.sjw_ket                      AS keterangan,
      LEFT(h.sjw_nomor, 3)           AS gudang_asal_kode,
      g_asal.gdg_nama                AS gudang_asal_nama,
      h.sjw_tujuan_cab               AS tujuan_kode,
      g_tujuan.gdg_nama              AS tujuan_nama
    FROM tsj_workshop_hdr h
    LEFT JOIN tgudang g_asal   ON g_asal.gdg_kode   = LEFT(h.sjw_nomor, 3)
    LEFT JOIN tgudang g_tujuan ON g_tujuan.gdg_kode = h.sjw_tujuan_cab
    WHERE h.sjw_nomor = ?
  `;
  const [headerRows] = await pool.query(headerQuery, [nomorSjw]);
  if (headerRows.length === 0)
    throw new Error("Data SJ Workshop tidak ditemukan.");

  const itemsQuery = `
    SELECT
      d.sjwd_kode     AS kode,
      b.brgd_barcode  AS barcode,
      TRIM(CONCAT(
        IFNULL(a.brg_jeniskaos,''), ' ',
        IFNULL(a.brg_tipe,''), ' ',
        IFNULL(a.brg_lengan,''), ' ',
        IFNULL(a.brg_jeniskain,''), ' ',
        IFNULL(a.brg_warna,'')
      ))              AS nama,
      d.sjwd_ukuran   AS ukuran,
      d.sjwd_jumlah   AS jumlahKirim
    FROM tsj_workshop_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.sjwd_kode
    LEFT JOIN tbarangdc_dtl b 
      ON b.brgd_kode = d.sjwd_kode AND b.brgd_ukuran = d.sjwd_ukuran
    WHERE d.sjwd_nomor = ?
    ORDER BY d.sjwd_kode, d.sjwd_ukuran
  `;
  const [items] = await pool.query(itemsQuery, [nomorSjw]);

  return { header: headerRows[0], items, isWorkshop: true };
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
      0,
    );

    // --- 1️⃣ BATAL TERIMA ---
    if (totalTerima === 0) {
      if (header.isWorkshop) {
        // Workshop: cari tj_nomor dari ttrm_sj_hdr.tj_sj_workshop
        const [cekWk] = await connection.query(
          `SELECT tj_nomor FROM ttrm_sj_hdr WHERE tj_sj_workshop = ?`,
          [nomorSj],
        );
        const tjNomorBatal = cekWk[0]?.tj_nomor;
        if (tjNomorBatal) {
          await connection.query(
            `DELETE FROM ttrm_sj_dtl WHERE tjd_nomor = ?`,
            [tjNomorBatal],
          );
          await connection.query(`DELETE FROM ttrm_sj_hdr WHERE tj_nomor = ?`, [
            tjNomorBatal,
          ]);
        }
      } else {
        const [cekSjBatal] = await connection.query(
          `SELECT sj_noterima FROM tdc_sj_hdr WHERE sj_nomor = ?`,
          [nomorSj],
        );
        const tjNomorBatal = cekSjBatal[0]?.sj_noterima;
        if (tjNomorBatal) {
          await connection.query(
            `DELETE FROM ttrm_sj_dtl WHERE tjd_nomor = ?`,
            [tjNomorBatal],
          );
          await connection.query(`DELETE FROM ttrm_sj_hdr WHERE tj_nomor = ?`, [
            tjNomorBatal,
          ]);
          await connection.query(
            `UPDATE tdc_sj_hdr SET sj_noterima = '' WHERE sj_nomor = ?`,
            [nomorSj],
          );
        }
      }
      await connection.commit();
      return { message: "Penerimaan dibatalkan.", nomor: null };
    }

    // --- 2️⃣ CEK STATUS (EDIT ATAU BARU) ---
    let existingTjNomor = null;

    if (header.isWorkshop) {
      const [cekWk] = await connection.query(
        `SELECT tj_nomor FROM ttrm_sj_hdr WHERE tj_sj_workshop = ?`,
        [nomorSj],
      );
      existingTjNomor = cekWk[0]?.tj_nomor || null;
    } else {
      const [cekSj] = await connection.query(
        `SELECT sj_noterima FROM tdc_sj_hdr WHERE sj_nomor = ?`,
        [nomorSj],
      );
      if (cekSj.length === 0)
        throw new Error("Nomor Surat Jalan tidak valid / tidak ditemukan.");
      existingTjNomor = cekSj[0].sj_noterima || null;
    }

    const isEdit = existingTjNomor && existingTjNomor.trim() !== "";

    let tjNomor = null;
    let idrec = null;

    // --- 3️⃣ MENENTUKAN VARIABEL ---
    if (isEdit) {
      tjNomor = existingTjNomor;

      // Ambil idrec dari header terima yang sudah ada untuk konsistensi
      const [oldHeader] = await connection.query(
        `SELECT tj_idrec FROM ttrm_sj_hdr WHERE tj_nomor = ?`,
        [tjNomor],
      );

      if (oldHeader.length > 0) {
        idrec = oldHeader[0].tj_idrec;
      } else {
        // Fallback jika data header hilang tapi di SJ tercatat (kasus aneh data kotor)
        const timestamp = format(new Date(), "yyyyMMddHHmmssSSS");
        idrec = `${user.cabang}TJ${timestamp}`;
      }

      // Hapus detail lama (akan replace)
      await connection.query(`DELETE FROM ttrm_sj_dtl WHERE tjd_nomor = ?`, [
        tjNomor,
      ]);

      // Update header info (optional, misal user ubah tanggal terima)
      await connection.query(
        `UPDATE ttrm_sj_hdr 
          SET tj_tanggal = ?, user_modified = ?, date_modified = NOW() 
         WHERE tj_nomor = ?`,
        [tanggalTerima, user.kode, tjNomor],
      );
    } else {
      // --- 4️⃣ MODE INSERT BARU ---
      // Panggil generator dengan connection
      tjNomor = await generateNewTjNumber(
        connection,
        user.cabang,
        tanggalTerima,
      );

      const timestamp = format(new Date(), "yyyyMMddHHmmssSSS");
      idrec = `${user.cabang}TJ${timestamp}`;

      await connection.query(
        `INSERT INTO ttrm_sj_hdr 
          (tj_idrec, tj_nomor, tj_tanggal, tj_mt_nomor, tj_cab,
          tj_sj_workshop, user_create, date_create)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          idrec,
          tjNomor,
          tanggalTerima,
          nomorMinta,
          user.cabang,
          header.isWorkshop ? nomorSj : null, // ← set langsung saat INSERT
          user.kode,
        ],
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
        [detailValues],
      );
    }

    // --- 6️⃣ UPDATE RELASI ---
    if (!header.isWorkshop) {
      await connection.query(
        `UPDATE tdc_sj_hdr SET sj_noterima = ? WHERE sj_nomor = ?`,
        [tjNomor, nomorSj],
      );
    }
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
  loadInitialDataWorkshop,
  saveData,
};
