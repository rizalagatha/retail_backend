const pool = require("../config/database");

const getNextBarcodeNumber = async (cabang, tanggal) => {
  // Meniru logika getmaxnomor dari Delphi
  const prefix = `${cabang}BCD${tanggal.substring(2, 4)}${tanggal.substring(
    5,
    7
  )}`;
  const query = `
        SELECT IFNULL(MAX(RIGHT(bch_nomor, 5)), 0) as lastNum 
        FROM tbarcode_hdr 
        WHERE LEFT(bch_nomor, 10) = ?
    `;
  const [rows] = await pool.query(query, [prefix]);
  const lastNum = parseInt(rows[0].lastNum, 10);
  const newNum = (lastNum + 1).toString().padStart(5, "0");
  return `${prefix}${newNum}`;
};

const searchProducts = async (
  term,
  category,
  gudang,
  page,
  itemsPerPage,
  source
) => {
  const offset = (page - 1) * itemsPerPage;
  const searchTerm = term ? `%${term}%` : null;

  // 1. Mulai dari tabel master (tbarangdc) untuk memastikan semua produk terdaftar
  let fromClause = `
        FROM tbarangdc a
        LEFT JOIN tbarangdc_dtl b ON TRIM(a.brg_kode) = TRIM(b.brgd_kode)
    `;
  let whereClause = "WHERE a.brg_aktif=0 AND b.brgd_kode IS NOT NULL";
  let params = [];

  // Logika filter berdasarkan source sudah benar
  if (source === "minta-barang") {
    if (gudang === "K04") {
      whereClause += ' AND a.brg_ktg <> ""';
    } else if (gudang === "K05") {
      whereClause += ' AND a.brg_ktg = ""';
    }
  } else if (source === "mutasi-kirim") {
    if (gudang === "KBD") {
      whereClause += ' AND a.brg_ktg <> ""';
    }
  } else {
    // Filter default
    whereClause += ' AND a.brg_logstok="Y"';
    if (category === "Kaosan") {
      whereClause += ' AND (a.brg_ktg IS NULL OR a.brg_ktg = "")';
    } else {
      whereClause += ' AND a.brg_ktg IS NOT NULL AND a.brg_ktg <> ""';
    }
  }

  if (term) {
    whereClause += ` AND (
            a.brg_kode LIKE ? OR
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) LIKE ? OR
            b.brgd_barcode LIKE ?
        )`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  // 2. Hitung jumlah total varian (baris) yang cocok dengan filter
  const countQuery = `SELECT COUNT(*) as total ${fromClause} ${whereClause}`;
  const [countRows] = await pool.query(countQuery, params);
  const total = countRows[0].total;

  const dataQuery = `
        SELECT
            a.brg_kode AS kode,
            b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            b.brgd_harga AS harga,
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out)
                FROM tmasterstok m
                WHERE m.mst_aktif = "Y" AND m.mst_cab = ?
                AND m.mst_brg_kode = b.brgd_kode AND m.mst_ukuran = b.brgd_ukuran
            ), 0) AS stok
        ${fromClause}
        ${whereClause}
        ORDER BY nama, b.brgd_ukuran
        LIMIT ? OFFSET ?
    `;
  const dataParams = [gudang, ...params, itemsPerPage, offset];
  const [items] = await pool.query(dataQuery, dataParams);

  return { items, total };
};

const getProductDetails = async (productCode) => {
  // Mengambil detail ukuran dan barcode untuk produk yang dipilih
  const query = `
        SELECT 
            b.brgd_kode as kode,
            b.brgd_barcode as barcode,
            b.brgd_ukuran as ukuran,
            b.brgd_harga as harga,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
        WHERE b.brgd_kode = ?
    `;
  const [rows] = await pool.query(query, [productCode]);
  return rows;
};

const saveBarcode = async (data) => {
  const { header, details, user } = data;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Simpan Header
    await connection.query(
      "INSERT INTO tbarcode_hdr (bch_nomor, bch_tanggal, user_create, date_create) VALUES (?, ?, ?, NOW())",
      [header.nomor, header.tanggal, user.kode]
    );

    // 2. Simpan Detail
    for (const [index, detail] of details.entries()) {
      if (detail.kode && detail.jumlah > 0) {
        await connection.query(
          "INSERT INTO tbarcode_dtl (bcd_nomor, bcd_kode, bcd_ukuran, bcd_jumlah, bcd_nourut) VALUES (?, ?, ?, ?, ?)",
          [header.nomor, detail.kode, detail.ukuran, detail.jumlah, index + 1]
        );
      }
    }

    await connection.commit();
    return {
      success: true,
      message: `Data barcode ${header.nomor} berhasil disimpan.`,
    };
  } catch (error) {
    await connection.rollback();
    console.error("Error saving barcode:", error);
    throw new Error("Gagal menyimpan data barcode.");
  } finally {
    connection.release();
  }
};

const searchMaster = async (term, page, itemsPerPage) => {
  const offset = (page - 1) * itemsPerPage;
  const searchTerm = `%${term || ""}%`;
  const params = [searchTerm, searchTerm];

  // Query dari Delphi (hanya dari tbarangdc)
  const baseFrom = `FROM tbarangdc a WHERE a.brg_aktif = 0`;
  const searchWhere = `AND (a.brg_kode LIKE ? OR TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe)) LIKE ?)`;

  const countQuery = `SELECT COUNT(*) as total ${baseFrom} ${searchWhere}`;
  const [countRows] = await pool.query(countQuery, params);
  const total = countRows[0].total;

  const dataQuery = `
        SELECT 
            a.brg_kode AS kode, 
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama
        ${baseFrom} ${searchWhere}
        ORDER BY nama
        LIMIT ? OFFSET ?;
    `;
  const dataParams = [...params, itemsPerPage, offset];
  const [items] = await pool.query(dataQuery, dataParams);

  return { items, total };
};

const findByBarcode = async (barcode) => {
  console.log("Mulai query barcode:", barcode);
  const query = `
    SELECT
      d.brgd_barcode AS barcode,
      d.brgd_kode AS kode,
      TRIM(CONCAT(h.brg_jeniskaos, " ", h.brg_tipe, " ", h.brg_lengan, " ", h.brg_jeniskain, " ", h.brg_warna)) AS nama,
      d.brgd_ukuran AS ukuran,
      d.brgd_harga AS harga
    FROM tbarangdc_dtl d
    INNER JOIN tbarangdc h ON h.brg_kode = d.brgd_kode
    WHERE h.brg_aktif = 0 
      AND d.brgd_barcode = ?;
  `;
  const [rows] = await pool.query(query, [barcode]);
  console.log("Selesai query, hasil:", rows.length);
  if (rows.length === 0) {
    throw new Error("Barcode tidak ditemukan atau barang tidak aktif.");
  }
  return rows[0];
};

module.exports = {
  getNextBarcodeNumber,
  searchProducts,
  getProductDetails,
  saveBarcode,
  searchMaster,
  findByBarcode,
};
