const pool = require("../config/database");

// --- Helper untuk generate IDREC ---
const generateIdRec = (cabang) => {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");

  // Format: K08MWK20251204155447.134 (Gunakan MWK = Mutasi Workshop)
  return `${cabang}MWK${yyyy}${mm}${dd}${hh}${min}${ss}.${ms}`;
};

// Fungsi untuk mengambil data saat form dalam mode Ubah
const getForEdit = async (nomor) => {
  const headerQuery = `
    SELECT 
      h.mw_nomor AS nomor,
      h.mw_tanggal AS tanggal,
      h.mw_cab_tujuan AS storeTujuanKode,
      g.gdg_nama AS storeTujuanNama,
      h.mw_ket AS keterangan
    FROM tmutasi_workshop_hdr h
    LEFT JOIN tgudang g ON g.gdg_kode = h.mw_cab_tujuan
    WHERE h.mw_nomor = ?;
  `;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0) {
    throw new Error("Dokumen tidak ditemukan");
  }
  const header = headerRows[0];
  const gudangAsal = nomor.substring(0, 3);

  const itemsQuery = `
    SELECT 
      d.mwd_kode AS kode,
      b.brgd_barcode AS barcode,
      TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), " ", IFNULL(a.brg_tipe,''), " ", IFNULL(a.brg_lengan,''), " ", IFNULL(a.brg_jeniskain,''), " ", IFNULL(a.brg_warna,''))) AS nama,
      d.mwd_ukuran AS ukuran,
      d.mwd_jumlah AS jumlah,
      (IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=d.mwd_kode AND m.mst_ukuran=d.mwd_ukuran), 0) + d.mwd_jumlah) AS stok
    FROM tmutasi_workshop_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.mwd_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.mwd_kode AND b.brgd_ukuran = d.mwd_ukuran
    WHERE d.mwd_nomor = ?;
  `;
  const [items] = await pool.query(itemsQuery, [gudangAsal, nomor]);

  return { header, items };
};

// Fungsi untuk menghasilkan nomor baru
const generateNewNomor = async (cabang, tanggal) => {
  const year = new Date(tanggal).getFullYear().toString().substring(2);
  const prefix = `${cabang}.MWK.${year}`;
  const query = `
    SELECT IFNULL(MAX(RIGHT(mw_nomor, 5)), 0) + 1 AS next_num 
    FROM tmutasi_workshop_hdr 
    WHERE LEFT(mw_nomor, 10) = ?;
  `;
  const [rows] = await pool.query(query, [prefix]);
  const nextNum = rows[0].next_num.toString().padStart(5, "0");
  return `${prefix}${nextNum}`;
};

// Fungsi utama untuk menyimpan data
const save = async (payload, user) => {
  const { header, items, isNew } = payload;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let nomorDokumen = header.nomor;

    if (isNew) {
      nomorDokumen = await generateNewNomor(user.cabang, header.tanggal);
      const headerInsertQuery = `
        INSERT INTO tmutasi_workshop_hdr (
          mw_nomor, mw_tanggal, mw_cab_tujuan, mw_ket, 
          mw_cab_asal, user_create, date_create
        )
        VALUES (?, ?, ?, ?, ?, ?, NOW());
      `;
      await connection.query(headerInsertQuery, [
        nomorDokumen,
        header.tanggal,
        header.storeTujuanKode,
        header.keterangan,
        user.cabang,
        user.kode,
      ]);
    } else {
      const headerUpdateQuery = `
        UPDATE tmutasi_workshop_hdr 
        SET mw_tanggal = ?, mw_cab_tujuan = ?, mw_ket = ?, user_modified = ?, date_modified = NOW()
        WHERE mw_nomor = ? AND mw_cab_asal = ?
      `;
      await connection.query(headerUpdateQuery, [
        header.tanggal,
        header.storeTujuanKode,
        header.keterangan,
        user.kode,
        nomorDokumen,
        user.cabang,
      ]);
    }

    // Hapus detail lama
    await connection.query(
      "DELETE FROM tmutasi_workshop_dtl WHERE mwd_nomor = ?",
      [nomorDokumen],
    );

    // Insert detail baru
    if (items.length > 0) {
      const baseIdRec = generateIdRec(user.cabang);
      const itemInsertQuery = `
        INSERT INTO tmutasi_workshop_dtl (
            mwd_idrec,  -- ID Unik Baris Detail (Sbg Primary Key & Relasi Stok)
            mwd_nomor, 
            mwd_kode, 
            mwd_ukuran, 
            mwd_jumlah
        ) VALUES ?;
      `;

      // Mapping data detail
      const itemValues = items.map((item, index) => {
        // Buat IDREC unik per baris
        const mwd_idrec = `${baseIdRec}${index + 1}`;

        return [mwd_idrec, nomorDokumen, item.kode, item.ukuran, item.jumlah];
      });

      await connection.query(itemInsertQuery, [itemValues]);
    }

    await connection.commit();
    return {
      message: `Data berhasil disimpan dengan nomor ${nomorDokumen}`,
      nomor: nomorDokumen,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// Fungsi untuk lookup Tujuan Workshop
const lookupTujuanWorkshop = async () => {
  const query = `
    SELECT gdg_kode AS kode, gdg_nama AS nama 
    FROM tgudang 
    WHERE gdg_dc = 4
    ORDER BY gdg_kode;
  `;
  const [rows] = await pool.query(query);
  return rows;
};

// Fungsi untuk mendapatkan detail lengkap produk
const getProductDetails = async (kode, ukuran, gudang) => {
  const query = `
    SELECT 
      b.brgd_kode AS kode, b.brgd_barcode AS barcode,
      TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), " ", IFNULL(a.brg_tipe,''), " ", IFNULL(a.brg_lengan,''), " ", IFNULL(a.brg_jeniskain,''), " ", IFNULL(a.brg_warna,''))) AS nama,
      b.brgd_ukuran AS ukuran,
      IFNULL((SELECT SUM(m.mst_stok_in-m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif="Y" and m.mst_cab=? AND m.mst_brg_kode=b.brgd_kode AND m.mst_ukuran=b.brgd_ukuran),0) AS stok
    FROM tbarangdc_dtl b
    INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
    WHERE b.brgd_kode = ? AND b.brgd_ukuran = ?;
  `;
  const [rows] = await pool.query(query, [gudang, kode, ukuran]);
  if (rows.length === 0) throw new Error("Detail produk tidak ditemukan", 404);
  return rows[0];
};

const findByBarcode = async (barcode, gudang) => {
  const query = `
    SELECT
      d.brgd_barcode AS barcode,
      d.brgd_kode AS kode,
      TRIM(CONCAT(IFNULL(h.brg_jeniskaos,''), " ", IFNULL(h.brg_tipe,''), " ", IFNULL(h.brg_lengan,''), " ", IFNULL(h.brg_jeniskain,''), " ", IFNULL(h.brg_warna,''))) AS nama,
      d.brgd_ukuran AS ukuran,
      IFNULL((
        SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m 
        WHERE m.mst_aktif = 'Y' AND m.mst_cab = ? AND m.mst_brg_kode = d.brgd_kode AND m.mst_ukuran = d.brgd_ukuran
      ), 0) AS stok
    FROM tbarangdc_dtl d
    INNER JOIN tbarangdc h ON h.brg_kode = d.brgd_kode
    WHERE h.brg_aktif = 0 AND d.brgd_barcode = ?;
  `;
  const [rows] = await pool.query(query, [gudang, barcode]);
  if (rows.length === 0) {
    throw new Error("Barcode tidak ditemukan atau barang tidak aktif.");
  }
  return rows[0];
};

const getPrintData = async (nomor, user) => {
  const query = `
    SELECT 
      h.mw_nomor,
      h.mw_tanggal,
      h.mw_cab_tujuan,
      g_tujuan.gdg_nama,
      h.mw_ket,
      DATE_FORMAT(h.date_create, '%d-%m-%Y %H:%i:%s') AS created,
      h.user_create,
      d.mwd_kode,
      TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), " ", IFNULL(a.brg_tipe,''), " ", IFNULL(a.brg_lengan,''), " ", IFNULL(a.brg_jeniskain,''), " ", IFNULL(a.brg_warna,''))) AS nama_barang,
      d.mwd_ukuran,
      d.mwd_jumlah,
      g_asal.gdg_inv_nama,
      g_asal.gdg_inv_alamat, 
      g_asal.gdg_inv_kota,
      g_asal.gdg_inv_telp
    FROM tmutasi_workshop_hdr h
    LEFT JOIN tmutasi_workshop_dtl d ON d.mwd_nomor = h.mw_nomor
    LEFT JOIN tgudang g_tujuan ON g_tujuan.gdg_kode = h.mw_cab_tujuan
    LEFT JOIN tgudang g_asal ON g_asal.gdg_kode = h.mw_cab_asal
    LEFT JOIN tbarangdc a ON a.brg_kode = d.mwd_kode
    WHERE h.mw_nomor = ? AND h.mw_cab_asal = ?
    ORDER BY nama_barang, d.mwd_ukuran;
  `;
  const [rows] = await pool.query(query, [nomor, user.cabang]);
  if (rows.length === 0) {
    throw new Error("Data untuk dicetak tidak ditemukan");
  }

  const header = {
    nomor: rows[0].mw_nomor,
    tanggal: rows[0].mw_tanggal,
    keCabang: `${rows[0].mw_cab_tujuan} - ${rows[0].gdg_nama}`,
    keterangan: rows[0].mw_ket,
    created: rows[0].created,
    user_create: rows[0].user_create,
    perush_nama: rows[0].gdg_inv_nama,
    perush_alamat: `${rows[0].gdg_inv_alamat || ""}, ${rows[0].gdg_inv_kota || ""}`,
    perush_telp: rows[0].gdg_inv_telp,
  };

  const details = rows
    .filter((row) => row.mwd_kode)
    .map((row) => ({
      kode: row.mwd_kode,
      nama: row.nama_barang,
      ukuran: row.mwd_ukuran,
      jumlah: row.mwd_jumlah,
    }));

  return { header, details };
};

// ... fungsi lookupProductsForMutasiKirim bisa di-copy paste persis dari aslinya ...

module.exports = {
  getForEdit,
  save,
  lookupTujuanWorkshop,
  getProductDetails,
  findByBarcode,
  getPrintData,
};
