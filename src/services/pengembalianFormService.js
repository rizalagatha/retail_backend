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
      h.pj_nomor, h.pj_nama AS pic, h.pj_tanggal, h.pj_cab,
      d.idrec AS ref_idrec_dtl, d.pjd_kode AS kode, d.pjd_ukuran AS ukuran,
      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
      d.pjd_qty AS qty_pinjam,
      d.pjd_qty_kembali AS qty_sudah_kembali,
      (d.pjd_qty - d.pjd_qty_kembali) AS sisa_pinjam
    FROM tpeminjaman_hdr h
    JOIN tpeminjaman_dtl d ON d.pjd_nomor = h.pj_nomor
    LEFT JOIN tbarangdc a ON a.brg_kode = d.pjd_kode
    WHERE h.pj_nomor = ? AND (d.pjd_qty - d.pjd_qty_kembali) > 0`;

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

    // 1. Generate Nomor Baru (Format: CAB.PK.YYMM.0001)
    const date = new Date();
    const yyMM = format(date, "yyMM");
    const prefix = `${user.cabang}.PK.${yyMM}.`;

    const [maxRows] = await connection.query(
      `SELECT IFNULL(MAX(RIGHT(pk_nomor, 4)), 0) as max_nomor FROM tpengembalian_hdr WHERE pk_nomor LIKE ?`,
      [`${prefix}%`]
    );
    const nomorPK = `${prefix}${String(
      parseInt(maxRows[0].max_nomor) + 1
    ).padStart(4, "0")}`;

    // 2. Insert Header
    const idrecHdr = generateIdRec(user.cabang, "PKH");
    await connection.query(
      `INSERT INTO tpengembalian_hdr (idrec, pk_nomor, pk_ref_pinjam, pk_tanggal, pk_cab, pk_penerima, pk_ket, user_create, date_create)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        idrecHdr,
        nomorPK,
        header.ref_nomor, // pj_nomor asal
        header.tanggal || format(new Date(), "yyyy-MM-dd"),
        user.cabang,
        header.penerima,
        header.keterangan,
        user.kode,
      ]
    );

    // 3. Insert Detail & Validasi
    for (const item of items) {
      if (Number(item.jumlah_kembali) > 0) {
        // Validasi: Jangan sampai kembali melebihi sisa pinjam
        if (Number(item.jumlah_kembali) > Number(item.sisa_pinjam)) {
          throw new Error(`Jumlah kembali ${item.nama} melebihi sisa pinjam!`);
        }

        const idrecDtl = generateIdRec(user.cabang, "PKD");
        await connection.query(
          `INSERT INTO tpengembalian_dtl (idrec, pkd_nomor, pkd_kode, pkd_ukuran, pkd_qty_kembali)
           VALUES (?, ?, ?, ?, ?)`,
          [idrecDtl, nomorPK, item.kode, item.ukuran, item.jumlah_kembali]
        );

        // Update qty_kembali di tabel peminjaman_dtl secara manual jika trigger belum ada
        // Catatan: Ini opsional jika Anda sudah memasang trigger DB di Turn 92
        await connection.query(
          `UPDATE tpeminjaman_dtl SET pjd_qty_kembali = pjd_qty_kembali + ? 
           WHERE pjd_nomor = ? AND pjd_kode = ? AND pjd_ukuran = ?`,
          [item.jumlah_kembali, header.ref_nomor, item.kode, item.ukuran]
        );
      }
    }

    // 4. Update Status Lunas Pinjam jika semua barang sudah kembali
    await connection.query(
      `UPDATE tpeminjaman_hdr h
       SET h.pj_status_kembali = 'Y'
       WHERE h.pj_nomor = ? 
         AND NOT EXISTS (
           SELECT 1 FROM tpeminjaman_dtl d 
           WHERE d.pjd_nomor = h.pj_nomor AND (d.pjd_qty - d.pjd_qty_kembali) > 0
         )`,
      [header.ref_nomor]
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
