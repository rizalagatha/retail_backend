const pool = require("../config/database");

// Fungsi untuk mengambil data saat form dalam mode Ubah
const getForEdit = async (nomor) => {
  const headerQuery = `
        SELECT 
            h.msk_nomor AS nomor,
            h.msk_tanggal AS tanggal,
            h.msk_kecab AS storeTujuanKode,
            g.gdg_nama AS storeTujuanNama,
            h.msk_ket AS keterangan
        FROM tmsk_hdr h
        LEFT JOIN tgudang g ON g.gdg_kode = h.msk_kecab
        WHERE h.msk_nomor = ?;
    `;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0) {
    throw new Error("Dokumen tidak ditemukan");
  }
  const header = headerRows[0];
  const gudangAsal = nomor.substring(0, 3);

  const itemsQuery = `
        SELECT 
            d.mskd_kode AS kode,
            b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d.mskd_ukuran AS ukuran,
            d.mskd_jumlah AS jumlah,
            (IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=d.mskd_kode AND m.mst_ukuran=d.mskd_ukuran), 0) + d.mskd_jumlah) AS stok
        FROM tmsk_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.mskd_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.mskd_kode AND b.brgd_ukuran = d.mskd_ukuran
        WHERE d.mskd_nomor = ?;
    `;
  const [items] = await pool.query(itemsQuery, [gudangAsal, nomor]);

  return { header, items };
};

// Fungsi untuk menghasilkan nomor baru
const generateNewNomor = async (cabang, tanggal) => {
  const year = new Date(tanggal).getFullYear().toString().substring(2);
  const prefix = `${cabang}.MSK.${year}`;
  const query = `
        SELECT IFNULL(MAX(RIGHT(msk_nomor, 5)), 0) + 1 AS next_num 
        FROM tmsk_hdr 
        WHERE LEFT(msk_nomor, 10) = ?;
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
                INSERT INTO tmsk_hdr (msk_nomor, msk_tanggal, msk_kecab, msk_ket, user_create, date_create)
                VALUES (?, ?, ?, ?, ?, NOW());
            `;
      await connection.query(headerInsertQuery, [
        nomorDokumen,
        header.tanggal,
        header.storeTujuanKode,
        header.keterangan,
        user.kode,
      ]);
    } else {
      const headerUpdateQuery = `
                UPDATE tmsk_hdr SET msk_tanggal = ?, msk_kecab = ?, msk_ket = ?, user_modified = ?, date_modified = NOW()
                WHERE msk_nomor = ?;
            `;
      await connection.query(headerUpdateQuery, [
        header.tanggal,
        header.storeTujuanKode,
        header.keterangan,
        user.kode,
        nomorDokumen,
      ]);
    }

    await connection.query("DELETE FROM tmsk_dtl WHERE mskd_nomor = ?", [
      nomorDokumen,
    ]);

    if (items.length > 0) {
      const itemInsertQuery = `
                INSERT INTO tmsk_dtl (mskd_nomor, mskd_kode, mskd_ukuran, mskd_jumlah) VALUES ?;
            `;
      const itemValues = items.map((item) => [
        nomorDokumen,
        item.kode,
        item.ukuran,
        item.jumlah,
      ]);
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

// Fungsi untuk lookup Store Tujuan
const lookupTujuanStore = async (userCabang) => {
  const query = `
        SELECT gdg_kode AS kode, gdg_nama AS nama 
        FROM tgudang 
        WHERE gdg_dc = 0 AND gdg_kode <> ? 
        ORDER BY gdg_kode;
    `;
  const [rows] = await pool.query(query, [userCabang]);
  return rows;
};

// Fungsi untuk mendapatkan detail lengkap produk saat dipilih dari modal
const getProductDetails = async (kode, ukuran, gudang) => {
  const query = `
        SELECT 
            b.brgd_kode AS kode, b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
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
  // Query ini akan mencari detail produk berdasarkan barcode
  const query = `
        SELECT
            d.brgd_barcode AS barcode,
            d.brgd_kode AS kode,
            TRIM(CONCAT(h.brg_jeniskaos, " ", h.brg_tipe, " ", h.brg_lengan, " ", h.brg_jeniskain, " ", h.brg_warna)) AS nama,
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
    throw new AppError("Barcode tidak ditemukan atau barang tidak aktif.", 404);
  }
  return rows[0];
};

const getPrintData = async (nomor) => {
  const query = `
        SELECT 
            h.msk_nomor,
            h.msk_tanggal,
            h.msk_kecab,
            g_tujuan.gdg_nama,
            h.msk_ket,
            DATE_FORMAT(h.date_create, '%d-%m-%Y %H:%i:%s') AS created,
            h.user_create,
            d.mskd_kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama_barang,
            d.mskd_ukuran,
            d.mskd_jumlah,
            -- Ambil info perusahaan dari cabang asal (g_asal)
            g_asal.gdg_inv_nama,
            g_asal.gdg_inv_alamat, -- Asumsi nama kolom alamat adalah gdg_inv_alamat
            g_asal.gdg_inv_kota,
            g_asal.gdg_inv_telp
        FROM tmsk_hdr h
        LEFT JOIN tmsk_dtl d ON d.mskd_nomor = h.msk_nomor
        LEFT JOIN tgudang g_tujuan ON g_tujuan.gdg_kode = h.msk_kecab
        -- --- PERBAIKAN: JOIN ke tgudang untuk info perusahaan (cabang asal) ---
        LEFT JOIN tgudang g_asal ON g_asal.gdg_kode = LEFT(h.msk_nomor, 3)
        LEFT JOIN tbarangdc a ON a.brg_kode = d.mskd_kode
        WHERE h.msk_nomor = ?
        ORDER BY nama_barang, d.mskd_ukuran;
    `;
  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) {
    throw new Error("Data untuk dicetak tidak ditemukan");
  }

  // Proses data menjadi format { header, details }
  const header = {
    nomor: rows[0].msk_nomor,
    tanggal: rows[0].msk_tanggal,
    keCabang: `${rows[0].msk_kecab} ${rows[0].gdg_nama}`,
    keterangan: rows[0].msk_ket,
    created: rows[0].created,
    user_create: rows[0].user_create,
    // Gunakan data dinamis dari query
    perush_nama: rows[0].gdg_inv_nama,
    perush_alamat: `${rows[0].gdg_inv_alamat || ""}, ${
      rows[0].gdg_inv_kota || ""
    }`, // Gabungkan alamat & kota
    perush_telp: rows[0].gdg_inv_telp,
  };

  const details = rows
    .filter((row) => row.mskd_kode) // Hanya proses baris yang memiliki detail
    .map((row) => ({
      kode: row.mskd_kode,
      nama: row.nama_barang,
      ukuran: row.mskd_ukuran,
      jumlah: row.mskd_jumlah,
    }));

  return { header, details };
};

const lookupProductsForMutasiKirim = async (gudang) => {
  let query = `
        SELECT
            b.brgd_kode AS kode,
            b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            a.brg_ktg AS kategori, -- Tambahkan kategori jika diperlukan di modal
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out)
                FROM tmasterstok m
                WHERE m.mst_aktif = "Y"
                  AND m.mst_cab = ?
                  AND m.mst_brg_kode = b.brgd_kode
                  AND m.mst_ukuran = b.brgd_ukuran
            ), 0) AS stok
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
        WHERE a.brg_aktif = 0 AND a.brg_logstok = "Y"
    `;

  // Filter spesifik cabang K04/K05 dari Delphi
  if (gudang === "K04") {
    query += ' AND a.brg_ktg <> ""';
  } else if (gudang === "K05") {
    query += ' AND a.brg_ktg = ""';
  }

  query += `
        ORDER BY a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna, RIGHT(b.brgd_barcode, 2)
    `;

  const [rows] = await pool.query(query, [gudang]);

  // Tambahkan uniqueId untuk frontend v-data-table
  return rows.map((row) => ({
    ...row,
    uniqueId: `${row.kode}-${row.ukuran}`,
  }));
};

module.exports = {
  getForEdit,
  save,
  lookupTujuanStore,
  getProductDetails,
  findByBarcode,
  getPrintData,
  lookupProductsForMutasiKirim,
};
