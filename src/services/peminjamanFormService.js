const pool = require("../config/database");
const { format, addDays } = require("date-fns");

// Helper Idrec
const generateIdRec = (cab, type) => {
  const timestamp = format(new Date(), "yyyyMMddHHmmssSSS");
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${cab}${type}${timestamp}${random}`;
};

const getNomor = async (connection, cab) => {
  const prefix = `PJ.${cab}.${format(new Date(), "yyMM")}`;
  const [rows] = await connection.query(
    `SELECT IFNULL(MAX(RIGHT(pj_nomor, 4)), 0) as max_nomor FROM tpeminjaman_hdr WHERE pj_nomor LIKE ?`,
    [`${prefix}%`]
  );
  const nextNo = parseInt(rows[0].max_nomor) + 1;
  return `${prefix}.${String(nextNo).padStart(4, "0")}`;
};

const saveData = async (payload, user) => {
  const { header, items, approver } = payload;
  const connection = await pool.getConnection();
  const isEdit = !!header.nomor;

  try {
    await connection.beginTransaction();

    // 1. Tentukan Status berdasarkan ada tidaknya approver
    // Jika ada approver (hasil sukses otorisasi), set ke 'ACC'
    const statusAcc = approver ? "ACC" : "WAIT";

    // --- VALIDASI STOK SEBELUM LANJUT ---
    // for (const item of items) {
    //   const [stokRows] = await connection.query(
    //     `SELECT IFNULL(SUM(mst_stok_in - mst_stok_out), 0) AS saldo 
    //              FROM tmasterstok 
    //              WHERE mst_aktif = "Y" AND mst_cab = ? AND mst_brg_kode = ? AND mst_ukuran = ?`,
    //     [user.cabang, item.kode, item.ukuran]
    //   );

    //   const stokTersedia = stokRows[0].saldo;
    //   if (item.jumlah > stokTersedia) {
    //     throw new Error(
    //       `Stok tidak cukup untuk ${item.nama} (${item.ukuran}). Tersedia: ${stokTersedia}, Diminta: ${item.jumlah}`
    //     );
    //   }
    // }

    let nomorPJ = header.nomor;
    const tglPinjam = header.tanggal || format(new Date(), "yyyy-MM-dd");
    const deadline = format(addDays(new Date(tglPinjam), 14), "yyyy-MM-dd");

    if (isEdit) {
      // Update Header (Hanya jika belum ACC/TOLAK)
      await connection.query(
        `UPDATE tpeminjaman_hdr SET pj_nama = ?, pj_ket = ?, user_create = ?, pj_status_acc = ? WHERE pj_nomor = ?`,
        [header.pic, header.keterangan, user.kode, statusAcc, nomorPJ]
      );
      await connection.query(
        `DELETE FROM tpeminjaman_dtl WHERE pjd_nomor = ?`,
        [nomorPJ]
      );
    } else {
      // Cari bagian generate nomor baru:
      const date = new Date();
      const yyMM = format(date, "yyMM");
      // UBAH: PJ.K01.2601. -> K01.PJ.2601.
      const prefix = `${user.cabang}.PJ.${yyMM}.`;

      const [maxRows] = await connection.query(
        `SELECT IFNULL(MAX(RIGHT(pj_nomor, 4)), 0) as max_nomor FROM tpeminjaman_hdr WHERE pj_nomor LIKE ?`,
        [`${prefix}%`]
      );
      nomorPJ = `${prefix}${String(parseInt(maxRows[0].max_nomor) + 1).padStart(
        4,
        "0"
      )}`;

      const idrecHdr = generateIdRec(user.cabang, "PJH");
      // Gunakan variabel statusAcc di sini
      await connection.query(
        `INSERT INTO tpeminjaman_hdr (idrec, pj_nomor, pj_tanggal, pj_deadline, pj_cab, pj_nama, pj_ket, pj_status_acc, user_create) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          idrecHdr,
          nomorPJ,
          tglPinjam,
          deadline,
          user.cabang,
          header.pic,
          header.keterangan,
          statusAcc,
          user.kode,
        ]
      );
    }

    // Insert Detail dengan idrec per baris
    for (const item of items) {
      const idrecDtl = generateIdRec(user.cabang, "PJD");
      await connection.query(
        `INSERT INTO tpeminjaman_dtl (idrec, pjd_nomor, pjd_kode, pjd_ukuran, pjd_qty, pjd_qty_kembali) 
                 VALUES (?, ?, ?, ?, ?, 0)`,
        [idrecDtl, nomorPJ, item.kode, item.ukuran, item.jumlah]
      );
    }

    await connection.commit();
    return {
      success: true,
      message: `Peminjaman ${nomorPJ} berhasil disimpan.`,
      nomor: nomorPJ,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const lookupProductByBarcode = async (barcode, cabang) => {
  const cleanedBarcode = barcode.replace(/^0+/, ""); // Bersihkan prefix nol

  const query = `
    SELECT 
      b.brgd_kode AS kode, 
      b.brgd_barcode AS barcode, 
      b.brgd_ukuran AS ukuran,
      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
      a.brg_ktgp AS kategori,
      b.brgd_harga AS harga,
      -- Hitung Saldo Stok Fisik Real-time
      IFNULL((
        SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
        FROM tmasterstok m 
        WHERE m.mst_aktif = 'Y' 
          AND m.mst_cab = ? 
          AND m.mst_brg_kode = b.brgd_kode 
          AND m.mst_ukuran = b.brgd_ukuran
      ), 0) AS stok
    FROM tbarangdc_dtl b
    INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
    WHERE a.brg_aktif = 0 
      AND (b.brgd_barcode = ? OR b.brgd_barcode = ?)`;

  const [rows] = await pool.query(query, [cabang, barcode, cleanedBarcode]);
  if (rows.length === 0)
    throw new Error("Barcode tidak ditemukan atau barang non-aktif.");
  return rows[0];
};

/**
 * Lookup barang untuk ProductSearchModal
 * Harga diambil dari brgd_harga di tabel detail (tbarangdc_dtl)
 */
const lookupProducts = async (filters) => {
  const page = parseInt(filters.page, 10) || 1;
  const itemsPerPage = parseInt(filters.itemsPerPage, 10) || 25;
  const { term, gudang, category } = filters;

  const offset = (page - 1) * itemsPerPage;
  const searchTerm = term ? `%${term}%` : null;

  // 1. Definisikan FROM dan JOIN
  // Join b (tbarangdc_dtl) untuk mendapatkan barcode, ukuran, dan harga
  let fromClause = `
    FROM tbarangdc a
    INNER JOIN tbarangdc_dtl b ON a.brg_kode = b.brgd_kode
  `;
  
  let whereClause = `WHERE a.brg_aktif = 0`; 
  let params = [];

  const cabCode = gudang || 'KDC'; 

  if (term) {
    whereClause += ` AND (a.brg_kode LIKE ? OR b.brgd_barcode LIKE ? OR a.brg_warna LIKE ? OR 
                     TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) LIKE ?)`;
    params.push(searchTerm, searchTerm, searchTerm, searchTerm);
  }

  if (category && category !== 'ALL') {
    whereClause += ` AND a.brg_ktg = ?`;
    params.push(category);
  }

  // 2. Hitung Total Data
  const countQuery = `SELECT COUNT(*) as total ${fromClause} ${whereClause}`;
  const [countRows] = await pool.query(countQuery, params);
  const total = countRows[0].total;

  // 3. Ambil Data Detail
  const dataQuery = `
        SELECT
            a.brg_kode AS kode,
            b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            a.brg_ktg AS kategori,
            b.brgd_harga AS harga, -- [FIX] Ambil harga dari tabel detail
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                FROM tmasterstok m 
                WHERE m.mst_aktif = "Y" 
                AND m.mst_cab = ? 
                AND m.mst_brg_kode = a.brg_kode 
                AND m.mst_ukuran = b.brgd_ukuran
            ), 0) AS stok
        ${fromClause}
        ${whereClause}
        ORDER BY a.brg_kode ASC, b.brgd_barcode ASC
        LIMIT ? OFFSET ?
    `;
  
  const dataParams = [cabCode, ...params, itemsPerPage, offset];

  const [items] = await pool.query(dataQuery, dataParams);
  return { items, total };
};

/**
 * Mengambil data lengkap untuk cetakan form peminjaman
 */
/**
 * Mengambil data lengkap untuk cetakan form peminjaman
 * Mengambil info perusahaan dari tabel tgudang berdasarkan pj_cab
 */
const getPrintData = async (nomor) => {
  const query = `
    SELECT 
      h.pj_nomor, 
      h.pj_tanggal, 
      h.pj_deadline, 
      h.pj_nama AS pic, 
      h.pj_ket, 
      h.pj_cab,
      DATE_FORMAT(h.date_create, '%d-%m-%Y %H:%i:%s') AS created,
      h.user_create,
      d.pjd_kode,
      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama_barang,
      d.pjd_ukuran,
      d.pjd_qty,
      g.gdg_nama AS dari_store,
      g.gdg_inv_nama,
      g.gdg_inv_alamat,
      g.gdg_inv_kota,
      g.gdg_inv_telp,
      -- Sub-query untuk mengambil nama approver dari log otorisasi
      (SELECT o_approver 
       FROM totorisasi 
       WHERE (o_transaksi = h.pj_nomor OR o_transaksi = 'DRAFT') 
       AND o_jenis = 'PEMINJAMAN_BARANG' 
       AND o_status = 'Y' 
       ORDER BY o_approved_at DESC LIMIT 1) AS approver
    FROM tpeminjaman_hdr h
    LEFT JOIN tpeminjaman_dtl d ON d.pjd_nomor = h.pj_nomor
    LEFT JOIN tgudang g ON g.gdg_kode = h.pj_cab
    LEFT JOIN tbarangdc a ON a.brg_kode = d.pjd_kode
    WHERE h.pj_nomor = ?;
  `;

  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) throw new Error("Data peminjaman tidak ditemukan.");

  const header = {
    nomor: rows[0].pj_nomor,
    tanggal: rows[0].pj_tanggal,
    deadline: rows[0].pj_deadline,
    pic: rows[0].pic,
    keterangan: rows[0].pj_ket,
    created: rows[0].created,
    user_create: rows[0].user_create,
    approver: rows[0].approver, // Muncul di kolom "Mengetahui"
    dariStore: rows[0].dari_store,
    // Info Perusahaan dari Tabel Gudang
    perush_nama: rows[0].gdg_inv_nama,
    perush_alamat: `${rows[0].gdg_inv_alamat || ""}, ${rows[0].gdg_inv_kota || ""}`,
    perush_telp: rows[0].gdg_inv_telp,
  };

  const details = rows
    .filter((r) => r.pjd_kode)
    .map((r) => ({
      kode: r.pjd_kode,
      nama: r.nama_barang,
      ukuran: r.pjd_ukuran,
      jumlah: r.pjd_qty,
    }));

  return { header, details };
};

module.exports = {
  saveData,
  lookupProductByBarcode,
  lookupProducts,
  getPrintData,
};
