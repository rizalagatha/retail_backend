const pool = require("../config/database");

// Fungsi untuk mengambil data saat form dalam mode Ubah
const getForEdit = async (nomor, user) => {
  // Ambil header + informasi gudang
  const headerQuery = `
    SELECT 
        h.kor_nomor AS nomor,
        h.kor_tanggal AS tanggal,
        h.kor_cab AS gudang,
        g.gdg_nama AS gudang_nama,
        h.kor_ket AS keterangan
    FROM tkor_hdr h
    LEFT JOIN tgudang g ON g.gdg_kode = h.kor_cab
    WHERE h.kor_nomor = ?
  `;

  const [headerRows] = await pool.query(headerQuery, [nomor]);

  if (headerRows.length === 0) {
    throw new Error("Dokumen tidak ditemukan");
  }

  const header = {
    nomor: headerRows[0].nomor,
    tanggal: headerRows[0].tanggal,
    gudang: {
      kode: headerRows[0].gudang,
      nama: headerRows[0].gudang_nama,
    },
    keterangan: headerRows[0].keterangan,
  };

  // Ambil detail item
  const itemsQuery = `
    SELECT
        d.kord_kode AS kode,
        b.brgd_barcode AS barcode,
        TRIM(CONCAT(
          a.brg_jeniskaos, " ",
          a.brg_tipe, " ",
          a.brg_lengan, " ",
          a.brg_jeniskain, " ",
          a.brg_warna
        )) AS nama,
        d.kord_ukuran AS ukuran,
        d.kord_stok AS stok,
        d.kord_jumlah AS jumlah,
        d.kord_hpp AS hpp,
        d.kord_ket AS keterangan
    FROM tkor_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.kord_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.kord_kode AND b.brgd_ukuran = d.kord_ukuran
    WHERE d.kord_kor_nomor = ?
  `;

  const [items] = await pool.query(itemsQuery, [nomor]);

  return { header, items };
};

// Fungsi untuk menyimpan data
const save = async (payload, user) => {
  const { header, items, isNew } = payload;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let nomorDokumen = header.nomor;
    if (isNew) {
      const yearMonth = new Date(header.tanggal)
        .toISOString()
        .slice(2, 7)
        .replace("-", "");
      const prefix = `${user.cabang}.KOR.${yearMonth}.`;
      const nomorQuery = `SELECT IFNULL(MAX(RIGHT(kor_nomor, 4)), 0) + 1 AS next_num FROM tkor_hdr WHERE LEFT(kor_nomor, 12) = ?;`;
      const [nomorRows] = await connection.query(nomorQuery, [prefix]);
      const nextNum = nomorRows[0].next_num.toString().padStart(4, "0");
      nomorDokumen = `${prefix}${nextNum}`;

      await connection.query(
        `INSERT INTO tkor_hdr 
          (kor_nomor, kor_tanggal, kor_cab, kor_ket, user_create, date_create)
        VALUES (?, ?, ?, ?, ?, NOW())`,
        [
          nomorDokumen,
          header.tanggal,
          user.cabang, // ← WAJIB
          header.keterangan,
          user.kode,
        ]
      );
    } else {
      await connection.query(
        `INSERT INTO tkor_hdr 
        (kor_nomor, kor_tanggal, kor_cab, kor_ket, user_create, date_create)
        VALUES (?, ?, ?, ?, ?, NOW())`,
        [
          nomorDokumen,
          header.tanggal,
          user.cabang, // ← WAJIB
          header.keterangan,
          user.kode,
        ]
      );
    }

    await connection.query("DELETE FROM tkor_dtl WHERE kord_kor_nomor = ?", [
      nomorDokumen,
    ]);

    if (items.length > 0) {
      const itemValues = items.map((i) => [
        nomorDokumen,
        i.kode,
        i.ukuran,
        i.stok,
        i.jumlah,
        i.jumlah - i.stok,
        i.hpp,
        i.keterangan,
      ]);
      await connection.query(
        "INSERT INTO tkor_dtl (kord_kor_nomor, kord_kode, kord_ukuran, kord_stok, kord_jumlah, kord_selisih, kord_hpp, kord_ket) VALUES ?",
        [itemValues]
      );
    }

    await connection.commit();
    return {
      message: `Koreksi Stok berhasil disimpan dengan nomor ${nomorDokumen}`,
      nomor: nomorDokumen,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// Fungsi untuk mendapatkan detail produk termasuk stok awal dan HPP (meniru loadbrg)
const getProductDetails = async (kode, ukuran, gudang, tanggal) => {
  const query = `
        SELECT 
            b.brgd_kode AS kode, b.brgd_barcode AS barcode, b.brgd_hpp AS hpp,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            (SELECT IFNULL(SUM(m.mst_stok_in - m.mst_stok_out), 0) FROM tmasterstok m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=? AND m.mst_ukuran=? AND m.mst_tanggal < ?) AS stok
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
        WHERE a.brg_aktif = 0 AND b.brgd_kode = ? AND b.brgd_ukuran = ?;
    `;
  const [rows] = await pool.query(query, [
    gudang,
    kode,
    ukuran,
    tanggal,
    kode,
    ukuran,
  ]);
  if (rows.length === 0) throw new Error("Detail produk tidak ditemukan");
  const duplicateCheckQuery = `
        SELECT h.kor_nomor FROM tkor_hdr h
        LEFT JOIN tkor_dtl d ON d.kord_kor_nomor = h.kor_nomor
        WHERE h.kor_cab = ?
          AND h.kor_tanggal = ?
          AND d.kord_kode = ?
          AND d.kord_ukuran = ?
        LIMIT 1;
    `;
  const [duplicateRows] = await pool.query(duplicateCheckQuery, [
    gudang,
    tanggal,
    kode,
    ukuran,
  ]);

  if (duplicateRows.length > 0) {
    throw new Error(
      `Barang ini sudah dikoreksi di No: ${duplicateRows[0].kor_nomor}`
    );
  }
  // --- AKHIR LOGIKA 'cekkor' ---

  return rows[0];
};

const findByBarcode = async (barcode, gudang, tanggal) => {
  // Langkah 1: Cari detail produk berdasarkan barcode (query yang sudah ada)
  const productQuery = `
        SELECT 
            b.brgd_kode AS kode, b.brgd_barcode AS barcode, b.brgd_hpp AS hpp,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            (SELECT IFNULL(SUM(m.mst_stok_in - m.mst_stok_out), 0) FROM tmasterstok m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=b.brgd_kode AND m.mst_ukuran=b.brgd_ukuran AND m.mst_tanggal < ?) AS stok
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
        WHERE a.brg_aktif = 0 AND b.brgd_barcode = ?;
    `;
  const [rows] = await pool.query(productQuery, [gudang, tanggal, barcode]);
  if (rows.length === 0) {
    throw new Error("Barcode tidak ditemukan atau barang tidak aktif.");
  }
  const product = rows[0];

  // --- Langkah 2: Terapkan logika 'cekkor' di sini ---
  const duplicateCheckQuery = `
        SELECT h.kor_nomor FROM tkor_hdr h
        LEFT JOIN tkor_dtl d ON d.kord_kor_nomor = h.kor_nomor
        WHERE h.kor_cab = ?
          AND h.kor_tanggal = ?
          AND d.kord_kode = ?
          AND d.kord_ukuran = ?
        LIMIT 1;
    `;
  const [duplicateRows] = await pool.query(duplicateCheckQuery, [
    gudang,
    tanggal,
    product.kode,
    product.ukuran,
  ]);

  if (duplicateRows.length > 0) {
    throw new Error(
      `Barang ini sudah dikoreksi di No: ${duplicateRows[0].kor_nomor}`
    );
  }
  // --- Akhir logika 'cekkor' ---

  // Langkah 3: Jika tidak ada duplikat, kembalikan data produk
  return product;
};

const lookupProducts = async (filters) => {
  const { term, gudang, page, itemsPerPage } = filters;
  const pageNum = parseInt(page, 10) || 1;
  const limit = parseInt(itemsPerPage, 10) || 10;
  const offset = (pageNum - 1) * limit;
  const searchTerm = term ? `%${term}%` : null;

  let fromClause = `
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
    `;
  let whereClause = 'WHERE a.brg_aktif=0 AND a.brg_logstok <> "N"';
  let params = [];

  // Logika filter khusus dari Delphi F2
  if (gudang === "K04") {
    whereClause += ' AND a.brg_ktg <> ""';
  } else if (gudang === "K05") {
    whereClause += ' AND a.brg_ktg = ""';
  }

  if (term) {
    whereClause += ` AND (b.brgd_barcode LIKE ? OR b.brgd_kode LIKE ? OR TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) LIKE ?)`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  const countQuery = `SELECT COUNT(*) as total ${fromClause} ${whereClause}`;
  const [countRows] = await pool.query(countQuery, params);
  const total = countRows[0].total;

  const dataQuery = `
        SELECT
            b.brgd_barcode AS barcode,
            b.brgd_kode AS kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            b.brgd_harga AS harga,
            CONCAT(b.brgd_kode, '-', b.brgd_ukuran) AS uniqueId
        ${fromClause} ${whereClause}
        ORDER BY nama, b.brgd_ukuran LIMIT ? OFFSET ?
    `;
  params.push(limit, offset);

  const [items] = await pool.query(dataQuery, params);
  return { items, total };
};

const getPrintData = async (nomor) => {
  const query = `
        SELECT 
            h.kor_nomor, h.kor_tanggal, h.kor_ket,
            DATE_FORMAT(h.date_create, '%d-%m-%Y %H:%i:%s') AS created,
            h.user_create,
            d.kord_kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama_barang,
            d.kord_ukuran,
            d.kord_stok,
            d.kord_jumlah,
            (d.kord_jumlah - d.kord_stok) AS selisih,
            d.kord_ket AS keterangan_item,
            g.gdg_inv_nama, g.gdg_inv_alamat, g.gdg_inv_kota, g.gdg_inv_telp, g.gdg_inv_instagram, g.gdg_inv_fb
        FROM tkor_hdr h
        LEFT JOIN tkor_dtl d ON d.kord_kor_nomor = h.kor_nomor
        LEFT JOIN tgudang g ON g.gdg_kode = h.kor_cab
        LEFT JOIN tbarangdc a ON a.brg_kode = d.kord_kode
        WHERE h.kor_nomor = ?;
    `;
  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) throw new Error("Data untuk dicetak tidak ditemukan.");

  const header = {
    nomor: rows[0].kor_nomor,
    tanggal: rows[0].kor_tanggal,
    keterangan: rows[0].kor_ket,
    created: rows[0].created,
    user_create: rows[0].user_create,
    perush_nama: rows[0].gdg_inv_nama,
    perush_alamat: `${rows[0].gdg_inv_alamat || ""}, ${
      rows[0].gdg_inv_kota || ""
    }`,
    perush_telp: rows[0].gdg_inv_telp,
    perush_instagram: rows[0].gdg_inv_instagram,
    perush_fb: rows[0].gdg_inv_fb,
  };
  const details = rows
    .filter((r) => r.kord_kode)
    .map((r) => ({
      kode: r.kord_kode,
      nama: r.nama_barang,
      ukuran: r.kord_ukuran,
      stok: r.kord_stok,
      koreksi: r.kord_jumlah, // 'jumlah' di delphi adalah stok fisik/koreksi
      selisih: r.selisih,
      keterangan: r.keterangan_item,
    }));

  return { header, details };
};

module.exports = {
  getForEdit,
  save,
  getProductDetails,
  findByBarcode,
  lookupProducts,
  getPrintData,
};
