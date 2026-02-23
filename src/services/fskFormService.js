const pool = require("../config/database");
const { format } = require("date-fns");

const toSqlDate = (value) => {
  if (!value) return null; // Izinkan NULL
  const d = new Date(value);
  if (isNaN(d.getTime())) return null; // Tangani tanggal tidak valid
  return format(d, "yyyy-MM-dd"); // Format ke YYYY-MM-DD
};

/**
 * Menghasilkan nomor Form Setoran Kasir (FSK) baru.
 */
const generateNewFskNumber = async (cabang, tanggal) => {
  const date = new Date(tanggal);
  const prefix = `${cabang}.FSK.${format(date, "yyMM")}.`;

  const query = `
        SELECT IFNULL(MAX(RIGHT(fsk_nomor, 5)), 0) + 1 AS next_num
        FROM tform_setorkasir_hdr 
        WHERE fsk_nomor LIKE ?;
    `;
  const [rows] = await pool.query(query, [`${prefix}%`]);
  const nextNumber = rows[0].next_num.toString().padStart(5, "0");

  return `${prefix}${nextNumber}`;
};

/**
 * Memuat data setoran harian untuk form baru.
 * Diperbarui untuk membedakan Transfer manual dan QRIS (Legacy Mode).
 */
const loadInitialData = async (tanggal, user) => {
  const { cabang } = user;
  const params = [cabang, tanggal];

  // 1. Query untuk grid pertama (detail setoran)
  const detail1Query = `
        -- A. TUNAI DARI INVOICE
        SELECT 
            'SETORAN KASIR TUNAI' AS jenis, h.inv_tanggal AS tgltrf, h.inv_cus_kode AS kdcus, 
            c.cus_nama AS nmcus, c.cus_alamat AS alamat, h.inv_nomor AS inv, 
            '' AS nomor, IFNULL(h.inv_rptunai, 0) AS nominal
        FROM tinv_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode=h.inv_cus_kode
        WHERE LEFT(h.inv_nomor,3)=? AND h.inv_sts_pro=0 AND h.inv_rptunai<>0 AND h.inv_tanggal=?
        
        UNION ALL
        
        -- B. PEMBAYARAN TUNAI (PELUNASAN)
        SELECT 
            'PEMBAYARAN TUNAI' AS jenis, NULL AS tgltrf, h.sh_cus_kode, 
            c.cus_nama, c.cus_alamat, 
            (SELECT d.sd_inv FROM tsetor_dtl d WHERE d.sd_sh_nomor=h.sh_nomor ORDER BY d.sd_tanggal DESC LIMIT 1) AS inv,
            h.sh_nomor, h.sh_nominal AS nominal
        FROM tsetor_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode=h.sh_cus_kode
        WHERE LEFT(h.sh_nomor,3)=? AND h.sh_jenis=0 AND h.sh_tanggal=?
        
        UNION ALL
        
        -- C. PEMBAYARAN TRANSFER (KECUALI YANG ADA KATA QRIS)
        SELECT 
            'PEMBAYARAN TRANSFER' AS jenis, h.sh_tgltransfer, h.sh_cus_kode, 
            c.cus_nama, c.cus_alamat,
            (SELECT d.sd_inv FROM tsetor_dtl d WHERE d.sd_sh_nomor=h.sh_nomor ORDER BY d.sd_tanggal DESC LIMIT 1) AS inv,
            h.sh_nomor, h.sh_nominal AS nominal
        FROM tsetor_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode=h.sh_cus_kode
        WHERE LEFT(h.sh_nomor,3)=? AND h.sh_jenis=1 AND h.sh_ket NOT LIKE '%QRIS%' AND h.sh_tanggal=?
        
        UNION ALL

        -- D. PEMBAYARAN QRIS (JENIS 1 DENGAN KETERANGAN QRIS)
        SELECT 
            'PEMBAYARAN QRIS' AS jenis, h.sh_tgltransfer, h.sh_cus_kode, 
            c.cus_nama, c.cus_alamat,
            (SELECT d.sd_inv FROM tsetor_dtl d WHERE d.sd_sh_nomor=h.sh_nomor ORDER BY d.sd_tanggal DESC LIMIT 1) AS inv,
            h.sh_nomor, h.sh_nominal AS nominal
        FROM tsetor_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode=h.sh_cus_kode
        WHERE LEFT(h.sh_nomor,3)=? AND h.sh_jenis=1 AND h.sh_ket LIKE '%QRIS%' AND h.sh_tanggal=?
        
        UNION ALL
        
        -- E. PEMBAYARAN GIRO
        SELECT 
            'PEMBAYARAN GIRO' AS jenis, h.sh_tglgiro, h.sh_cus_kode, 
            c.cus_nama, c.cus_alamat, 
            (SELECT d.sd_inv FROM tsetor_dtl d WHERE d.sd_sh_nomor=h.sh_nomor ORDER BY d.sd_tanggal DESC LIMIT 1) AS inv,
            h.sh_nomor, h.sh_nominal AS nominal
        FROM tsetor_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode=h.sh_cus_kode
        WHERE LEFT(h.sh_nomor,3)=? AND h.sh_jenis=2 AND h.sh_tanggal=?;
    `;

  // Total 5 Spread Params untuk 5 blok UNION ALL
  const [details1] = await pool.query(detail1Query, [
    ...params,
    ...params,
    ...params,
    ...params,
    ...params,
  ]);

  // 2. Query untuk grid kedua (summary per jenis)
  const detail2Query = `
        SELECT 'SETORAN KASIR TUNAI' AS jenis, IFNULL(SUM(h.inv_rptunai), 0) AS nominal FROM tinv_hdr h WHERE LEFT(h.inv_nomor,3)=? AND h.inv_sts_pro=0 AND h.inv_rptunai<>0 AND h.inv_tanggal=?
        UNION ALL
        SELECT "PEMBAYARAN TUNAI" AS jenis, IFNULL(SUM(s.sh_nominal),0) AS nominal FROM tsetor_hdr s WHERE LEFT(s.sh_nomor,3)=? AND s.sh_jenis=0 AND s.sh_tanggal=?
        UNION ALL
        SELECT "PEMBAYARAN TRANSFER" AS jenis, IFNULL(SUM(s.sh_nominal),0) AS nominal FROM tsetor_hdr s WHERE LEFT(s.sh_nomor,3)=? AND s.sh_jenis=1 AND s.sh_ket NOT LIKE '%QRIS%' AND s.sh_tanggal=?
        UNION ALL
        -- [FIX] Filter QRIS menggunakan LIKE pada keterangan
        SELECT "PEMBAYARAN QRIS" AS jenis, IFNULL(SUM(s.sh_nominal),0) AS nominal FROM tsetor_hdr s WHERE LEFT(s.sh_nomor,3)=? AND s.sh_jenis=1 AND s.sh_ket LIKE '%QRIS%' AND s.sh_tanggal=?
        UNION ALL
        SELECT "PEMBAYARAN GIRO" AS jenis, IFNULL(SUM(s.sh_nominal),0) AS nominal FROM tsetor_hdr s WHERE LEFT(s.sh_nomor,3)=? AND s.sh_jenis=2 AND s.sh_tanggal=?;
    `;

  const [details2] = await pool.query(detail2Query, [
    ...params,
    ...params,
    ...params,
    ...params,
    ...params,
  ]);

  return { details1, details2 };
};

const loadForEdit = async (nomor, user) => {
  // 1. Ambil data header
  const headerQuery = `
        SELECT 
            h.fsk_nomor AS nomor, 
            h.fsk_tanggal AS tanggal,
            h.user_create AS createdBy,
            h.fsk_userv AS verifiedBy,
            h.fsk_tanggalv AS verifiedDate
        FROM tform_setorkasir_hdr h
        WHERE h.fsk_nomor = ? AND LEFT(h.fsk_nomor, 3) = ?;
    `;
  const [headerRows] = await pool.query(headerQuery, [nomor, user.cabang]);
  if (headerRows.length === 0)
    throw new Error("Data FSK tidak ditemukan atau bukan milik cabang Anda.");

  // 2. Ambil detail 1
  const detail1Query = `
        SELECT
            d.fskd_jenis AS jenis, d.fskd_tgltrf AS tgltrf, d.fskd_kdcus AS kdcus,
            c.cus_nama AS nmcus, c.cus_alamat AS alamat, d.fskd_inv AS inv,
            d.fskd_sh_nomor AS nomor, d.fskd_nominal AS nominal
        FROM tform_setorkasir_dtl d
        LEFT JOIN tcustomer c ON c.cus_kode = d.fskd_kdcus
        WHERE d.fskd_nomor = ?;
    `;
  const [details1] = await pool.query(detail1Query, [nomor]);

  // 3. Ambil detail 2
  const detail2Query = `
        SELECT 
            fskd2_jenis AS jenis,
            fskd2_nominal AS nominal,
            fskd2_nominalv AS nominalv
        FROM tform_setorkasir_dtl2
        WHERE fskd2_nomor = ?;
    `;
  const [details2] = await pool.query(detail2Query, [nomor]);

  return { header: headerRows[0], details1, details2 };
};

const saveData = async (payload, user) => {
  const { header, details1, details2, isNew } = payload;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let fskNomor = header.nomor;
    const timestamp = format(new Date(), "yyyyMMddHHmmssSSS");
    const idrec = `${user.cabang}FSK${timestamp}`;

    if (isNew) {
      // --- VALIDASI LOCK: 1 FSK per Hari ---
      const checkSql = `
          SELECT fsk_nomor 
          FROM tform_setorkasir_hdr 
          WHERE LEFT(fsk_nomor, 3) = ? AND fsk_tanggal = ?
      `;
      const [existing] = await connection.query(checkSql, [
        user.cabang,
        header.tanggal,
      ]);

      if (existing.length > 0) {
        throw new Error(
          `Gagal: Cabang ${
            user.cabang
          } sudah membuat FSK untuk tanggal ${format(
            new Date(header.tanggal),
            "dd/MM/yyyy",
          )} (${existing[0].fsk_nomor}).`,
        );
      }
      // --- AKHIR VALIDASI ---
      fskNomor = await generateNewFskNumber(user.cabang, header.tanggal);
      const headerSql = `
                INSERT INTO tform_setorkasir_hdr (fsk_idrec, fsk_nomor, fsk_tanggal, user_create, date_create)
                VALUES (?, ?, ?, ?, NOW());
            `;
      await connection.query(headerSql, [
        idrec,
        fskNomor,
        header.tanggal,
        user.kode,
      ]);
    } else {
      const headerSql = `
                UPDATE tform_setorkasir_hdr SET fsk_tanggal = ?, user_modified = ?, date_modified = NOW()
                WHERE fsk_nomor = ?;
            `;
      await connection.query(headerSql, [header.tanggal, user.kode, fskNomor]);
    }

    // Simpan Detail 1
    await connection.query(
      "DELETE FROM tform_setorkasir_dtl WHERE fskd_nomor = ?",
      [fskNomor],
    );
    if (details1.length > 0) {
      const dtl1Sql = `
                INSERT INTO tform_setorkasir_dtl (fskd_idrec, fskd_nomor, fskd_jenis, fskd_tgltrf, fskd_kdcus, fskd_inv, fskd_sh_nomor, fskd_nominal)
                VALUES ?;
            `;
      const dtl1Values = details1.map((d) => [
        idrec,
        fskNomor,
        d.jenis,
        toSqlDate(d.tgltrf),
        d.kdcus,
        d.inv || "",
        d.nomor,
        d.nominal,
      ]);
      await connection.query(dtl1Sql, [dtl1Values]);
    }

    // Simpan Detail 2
    await connection.query(
      "DELETE FROM tform_setorkasir_dtl2 WHERE fskd2_nomor = ?",
      [fskNomor],
    );
    if (details2.length > 0) {
      const dtl2Sql = `
                INSERT INTO tform_setorkasir_dtl2 (fskd2_idrec, fskd2_nomor, fskd2_jenis, fskd2_nominal)
                VALUES ?;
            `;
      const dtl2Values = details2.map((d) => [
        idrec,
        fskNomor,
        d.jenis,
        d.nominal,
      ]);
      await connection.query(dtl2Sql, [dtl2Values]);
    }

    await connection.commit();
    return {
      message: `Form Setoran Kasir ${fskNomor} berhasil disimpan.`,
      nomor: fskNomor,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getPrintData = async (nomor) => {
  // 1. Ambil data header utama
  const headerQuery = `
    SELECT 
      h.fsk_nomor, h.fsk_tanggal, h.user_create,
      DATE_FORMAT(h.date_create, "%d-%m-%Y %T") AS created,
      src.gdg_inv_nama AS perush_nama,
      src.gdg_inv_alamat AS perush_alamat,
      src.gdg_inv_telp AS perush_telp
    FROM tform_setorkasir_hdr h
    LEFT JOIN tgudang src ON src.gdg_kode = LEFT(h.fsk_nomor, 3)
    WHERE h.fsk_nomor = ?;
  `;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0) {
    throw new Error("Data FSK tidak ditemukan.");
  }

  // 2. Ambil rincian setoran (detail 1)
  const detail1Query = `
    SELECT 
      d.fskd_jenis AS jenis,
      d.fskd_tgltrf AS tgltrf,
      d.fskd_kdcus AS kdcus,
      c.cus_nama AS nmcus,
      d.fskd_inv AS inv,
      d.fskd_sh_nomor AS nomor,
      d.fskd_nominal AS nominal
    FROM tform_setorkasir_dtl d
    LEFT JOIN tcustomer c ON c.cus_kode = d.fskd_kdcus
    WHERE d.fskd_nomor = ?
    ORDER BY d.fskd_jenis;
  `;
  const [details1] = await pool.query(detail1Query, [nomor]);

  // 3. Ambil rekapitulasi setoran (detail 2)
  const detail2Query = `
    SELECT 
      fskd2_jenis AS jenis,
      fskd2_nominal AS summary_nominal
    FROM tform_setorkasir_dtl2
    WHERE fskd2_nomor = ?;
  `;
  const [details2] = await pool.query(detail2Query, [nomor]);

  // Gabungkan semua data menjadi satu objek
  return { header: headerRows[0], details1, details2 };
};

const remove = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `
      SELECT fsk_userv, fsk_closing FROM tform_setorkasir_hdr WHERE fsk_nomor = ?
    `,
      [nomor],
    );

    if (rows.length === 0) throw new Error("Data tidak ditemukan.");
    const setoran = rows[0];

    // --- VALIDASI PENTING ---
    if (setoran.fsk_userv) {
      throw new Error("Sudah di Verifikasi oleh Finance. Tidak bisa dihapus.");
    }
    if (nomor.substring(0, 3) !== user.cabang) {
      throw new Error(
        `Anda tidak berhak menghapus data milik cabang ${nomor.substring(
          0,
          3,
        )}.`,
      );
    }
    if (setoran.fsk_closing === "Y") {
      throw new Error("Sudah Closing. Tidak bisa dihapus.");
    }
    // --- AKHIR VALIDASI ---

    await connection.query(
      "DELETE FROM tform_setorkasir_hdr WHERE fsk_nomor = ?",
      [nomor],
    );

    await connection.commit();
    return { message: `Form Setoran Kasir ${nomor} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  loadInitialData,
  loadForEdit,
  saveData,
  getPrintData,
  remove,
};
