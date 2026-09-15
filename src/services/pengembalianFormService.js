const pool = require("../config/database");
const { format } = require("date-fns");

// Helper Idrec
const generateIdRec = (cab, type) => {
  const timestamp = format(new Date(), "yyyyMMddHHmmssSSS");
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${cab}${type}${timestamp}${random}`;
};

/**
 * Mencari data pinjaman yang masih memiliki sisa barang (belum kembali)
 */
const getPinjamanForReturn = async (nomorPJ) => {
  const query = `
    SELECT 
      MAX(h.pj_nomor) AS pj_nomor, MAX(h.pj_nama) AS pic, MAX(h.pj_tanggal) AS pj_tanggal, MAX(h.pj_cab) AS pj_cab,
      d.pjd_kode AS kode, d.pjd_ukuran AS ukuran,
      MAX(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna))) AS nama,
      MAX(IFNULL(b.brgd_barcode, '')) AS barcode,
      SUM(d.pjd_qty) AS qty_pinjam,
      SUM(d.pjd_qty_kembali) AS qty_sudah_kembali,
      SUM(d.pjd_qty - d.pjd_qty_kembali) AS sisa_pinjam
    FROM tpeminjaman_hdr h
    JOIN tpeminjaman_dtl d ON d.pjd_nomor = h.pj_nomor
    LEFT JOIN tbarangdc a ON a.brg_kode = d.pjd_kode
    LEFT JOIN tbarangdc_dtl b ON a.brg_kode = b.brgd_kode AND d.pjd_ukuran = b.brgd_ukuran
    WHERE h.pj_nomor = ?
    GROUP BY d.pjd_kode, d.pjd_ukuran
    HAVING SUM(d.pjd_qty - d.pjd_qty_kembali) > 0`;

  const [rows] = await pool.query(query, [nomorPJ]);
  return rows;
};

/**
 * Menyimpan data pengembalian barang
 */
const saveData = async (payload, user) => {
  const { header, items } = payload;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const date = new Date();
    const yyMM = format(date, "yyMM");
    const prefix = `${user.cabang}.PK.${yyMM}.`;

    const [maxRows] = await connection.query(
      `SELECT IFNULL(MAX(RIGHT(pk_nomor, 4)), 0) as max_nomor FROM tpengembalian_hdr WHERE pk_nomor LIKE ?`,
      [`${prefix}%`],
    );
    const nomorPK = `${prefix}${String(parseInt(maxRows[0].max_nomor) + 1).padStart(4, "0")}`;

    const idrecHdr = generateIdRec(user.cabang, "PKH");
    await connection.query(
      `INSERT INTO tpengembalian_hdr (idrec, pk_nomor, pk_ref_pinjam, pk_tanggal, pk_cab, pk_penerima, pk_ket, user_create, date_create)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        idrecHdr,
        nomorPK,
        header.ref_nomor,
        header.tanggal || format(new Date(), "yyyy-MM-dd"),
        user.cabang,
        header.penerima,
        header.keterangan,
        user.kode,
      ],
    );

    const returnedSerials = [];

    for (const item of items) {
      const qtyKembali = Number(item.jumlah_kembali) || 0;
      if (qtyKembali <= 0) continue;

      if (Number(item.jumlah_kembali) > Number(item.sisa_pinjam)) {
        throw new Error(`Jumlah kembali ${item.nama} melebihi sisa pinjam!`);
      }

      // BARU: cari unit_serial spesifik yang masih DIPINJAM lewat
      // dokumen pinjam INI, dikurangi yang sudah pernah dibalikin di
      // dokumen pengembalian lain untuk pinjaman yang sama
      const [candidateRows] = await connection.query(
        `SELECT pjd_unit_serial FROM tpeminjaman_dtl
         WHERE pjd_nomor = ? AND pjd_kode = ? AND pjd_ukuran = ?
           AND pjd_unit_serial IS NOT NULL
           AND pjd_unit_serial NOT IN (
             SELECT pd.pkd_unit_serial FROM tpengembalian_dtl pd
             INNER JOIN tpengembalian_hdr ph ON ph.pk_nomor = pd.pkd_nomor
             WHERE ph.pk_ref_pinjam = ? AND pd.pkd_unit_serial IS NOT NULL
           )
         ORDER BY pjd_unit_serial ASC
         LIMIT ? FOR UPDATE`,
        [
          header.ref_nomor,
          item.kode,
          item.ukuran,
          header.ref_nomor,
          qtyKembali,
        ],
      );
      const pickedSerials = candidateRows.map((r) => r.pjd_unit_serial);

      for (const serial of pickedSerials) {
        const idrecDtl = generateIdRec(user.cabang, "PKD");
        await connection.query(
          `INSERT INTO tpengembalian_dtl (idrec, pkd_nomor, pkd_kode, pkd_ukuran, pkd_qty_kembali, pkd_unit_serial)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [idrecDtl, nomorPK, item.kode, item.ukuran, 1, serial],
        );
        returnedSerials.push(serial);
      }

      const sisaQty = qtyKembali - pickedSerials.length;
      if (sisaQty > 0) {
        const idrecDtl = generateIdRec(user.cabang, "PKD");
        await connection.query(
          `INSERT INTO tpengembalian_dtl (idrec, pkd_nomor, pkd_kode, pkd_ukuran, pkd_qty_kembali, pkd_unit_serial)
           VALUES (?, ?, ?, ?, ?, NULL)`,
          [idrecDtl, nomorPK, item.kode, item.ukuran, sisaQty],
        );
      }
    }

    if (returnedSerials.length > 0) {
      await connection.query(
        `UPDATE tbarangdc_unit SET unit_status = 'DI_TOKO', date_modified = NOW(), user_modified = ?
         WHERE unit_serial IN (?)`,
        [user.kode, returnedSerials],
      );
    }

    await connection.query(
      `UPDATE tpeminjaman_hdr h
       SET h.pj_status_kembali = 'Y'
       WHERE h.pj_nomor = ? 
         AND NOT EXISTS (
           SELECT 1 FROM tpeminjaman_dtl d 
           WHERE d.pjd_nomor = h.pj_nomor AND (d.pjd_qty - d.pjd_qty_kembali) > 0
         )`,
      [header.ref_nomor],
    );

    await connection.commit();
    return {
      success: true,
      message: `Pengembalian ${nomorPK} berhasil disimpan.`,
      nomor: nomorPK,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  getPinjamanForReturn,
  saveData,
};
