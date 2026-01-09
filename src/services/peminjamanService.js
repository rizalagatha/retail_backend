const pool = require("../config/database");
const { format, addDays } = require("date-fns");

// Helper untuk IDREC (Sama seperti Invoice/SO)
const generateIdRec = (cab, type) => {
  const timestamp = format(new Date(), "yyyyMMddHHmmssSSS");
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${cab}${type}${timestamp}${random}`;
};

const savePeminjaman = async (data, user) => {
  const { header, items } = data;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Hitung Deadline Otomatis (Tgl Pinjam + 14 Hari)
    const tglPinjam = header.pj_tanggal || format(new Date(), "yyyy-MM-dd");
    const deadline = format(addDays(new Date(tglPinjam), 14), "yyyy-MM-dd");

    // 2. Generate Nomor Dokumen (Jika Baru)
    const nomor =
      header.pj_nomor || (await generatePjNomor(user.cabang, connection));

    // 3. Simpan Header dengan idrec
    const idrecHdr = header.idrec || generateIdRec(user.cabang, "PJH");
    const sqlHdr = `
            INSERT INTO tpeminjaman_hdr 
            (idrec, pj_nomor, pj_tanggal, pj_deadline, pj_cab, pj_nama, pj_ket, pj_status_acc, user_create, date_create)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'WAIT', ?, NOW())
            ON DUPLICATE KEY UPDATE pj_nama = VALUES(pj_nama), pj_ket = VALUES(pj_ket)
        `;
    await connection.query(sqlHdr, [
      idrecHdr,
      nomor,
      tglPinjam,
      deadline,
      user.cabang,
      header.pj_nama,
      header.pj_ket,
      user.kode,
    ]);

    // 4. Simpan Detail dengan idrec per baris
    if (items && items.length > 0) {
      // Hapus detail lama jika mode edit (hanya jika masih WAIT)
      await connection.query(
        "DELETE FROM tpeminjaman_dtl WHERE pjd_nomor = ?",
        [nomor]
      );

      for (const item of items) {
        const idrecDtl = generateIdRec(user.cabang, "PJD");
        const sqlDtl = `
                    INSERT INTO tpeminjaman_dtl (idrec, pjd_nomor, pjd_kode, pjd_ukuran, pjd_qty, pjd_qty_kembali)
                    VALUES (?, ?, ?, ?, ?, 0)
                `;
        await connection.query(sqlDtl, [
          idrecDtl,
          nomor,
          item.kode,
          item.ukuran,
          item.jumlah,
        ]);
      }
    }

    await connection.commit();
    return { message: "Peminjaman berhasil disimpan.", nomor: nomor };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getList = async (filters, user) => {
  const { startDate, endDate } = filters;
  const query = `
        SELECT 
            h.idrec, 
            h.pj_nomor AS nomor, 
            h.pj_tanggal AS tanggal, 
            h.pj_deadline AS deadline, 
            h.pj_cab AS store,
            h.pj_nama AS pic, 
            h.pj_ket AS keterangan,
            h.pj_status_acc AS statusEdit, 
            h.pj_status_kembali AS statusKembali, 
            h.user_create AS userCreate,
            (SELECT SUM(pjd_qty) FROM tpeminjaman_dtl WHERE pjd_nomor = h.pj_nomor) AS totalQty,
            /* Ambil nomor pengembalian jika sudah ada */
            (SELECT pk_nomor FROM tpengembalian_hdr WHERE pk_ref_pinjam = h.pj_nomor LIMIT 1) AS noKembali
        FROM tpeminjaman_hdr h
        WHERE h.pj_cab = ? AND h.pj_tanggal BETWEEN ? AND ?
        ORDER BY h.pj_nomor DESC`;

  const [rows] = await pool.query(query, [user.cabang, startDate, endDate]);
  return rows;
};

const getDetail = async (nomor) => {
  const query = `
        SELECT 
            d.pjd_kode AS kode, 
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d.pjd_ukuran AS ukuran, 
            d.pjd_qty AS jumlah
        FROM tpeminjaman_dtl d
        LEFT JOIN tbarangdc a ON d.pjd_kode = a.brg_kode
        WHERE d.pjd_nomor = ?`;

  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

// Helper internal untuk nomor dokumen (PJ.CAB.YYMM.XXXX)
async function generatePjNomor(cab, conn) {
  const prefix = `PJ.${cab}.${format(new Date(), "yyMM")}.`;
  const [rows] = await conn.query(
    "SELECT MAX(pj_nomor) as last FROM tpeminjaman_hdr WHERE pj_nomor LIKE ?",
    [prefix + "%"]
  );
  const lastNo = rows[0].last ? parseInt(rows[0].last.split(".").pop()) : 0;
  return prefix + (lastNo + 1).toString().padStart(4, "0");
}

module.exports = { savePeminjaman, getList, getDetail };
