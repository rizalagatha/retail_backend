const pool = require("../config/database");

const getNextBarcodeNumber = async (cabang, tanggal) => {
  // Meniru logika getmaxnomor dari Delphi
  const prefix = `${cabang}BCD${tanggal.substring(2, 4)}${tanggal.substring(
    5,
    7,
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
  source,
) => {
  const offset = (page - 1) * itemsPerPage;

  let fromClause = `
    FROM tbarangdc a
    LEFT JOIN tbarangdc_dtl b 
      ON a.brg_kode = b.brgd_kode
  `;

  let whereClause = `
    WHERE a.brg_aktif = 0 
      AND b.brgd_kode IS NOT NULL
  `;

  const params = [];

  // ---------- FILTER SOURCE ----------
  if (source === "minta-barang") {
    if (gudang === "K04") whereClause += ` AND a.brg_ktg <> ''`;
    else if (gudang === "K05") whereClause += ` AND a.brg_ktg = ''`;
  } else if (source === "mutasi-kirim" && gudang === "KBD") {
    whereClause += ` AND a.brg_ktg <> ''`;
  } else {
    whereClause += ` AND a.brg_logstok='Y'`;
    if (category === "Kaosan")
      whereClause += ` AND (a.brg_ktg IS NULL OR a.brg_ktg = '')`;
    else whereClause += ` AND a.brg_ktg IS NOT NULL AND a.brg_ktg <> ''`;
  }

  // ---------- SMART MULTI-TOKEN SEARCH ----------
  const tokens = (term || "")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (tokens.length > 0) {
    whereClause += " AND (";
    const parts = [];

    for (const t of tokens) {
      parts.push(`
    (
      LOWER(a.brg_kode) LIKE ?
      OR LOWER(b.brgd_barcode) LIKE ?
      OR LOWER(a.brg_tipe) LIKE ?
      OR LOWER(a.brg_warna) LIKE ?
      OR LOWER(a.brg_jeniskain) LIKE ?
      OR LOWER(a.brg_lengan) LIKE ?
      OR LOWER(CONCAT_WS(
        ' ',
        a.brg_jeniskaos,
        a.brg_tipe,
        a.brg_lengan,
        a.brg_jeniskain,
        a.brg_warna
      )) LIKE ?
    )
  `);

      const like = `%${t.toLowerCase()}%`;

      params.push(like, like, like, like, like, like, like);
    }

    // semua token HARUS match (AND antar token)
    whereClause += parts.join(" AND ");
    whereClause += ")";
  }

  // ---------- DATA QUERY ----------
  const dataQuery = `
    SELECT SQL_CALC_FOUND_ROWS
      a.brg_kode AS kode,
      b.brgd_barcode AS barcode,

      CONCAT_WS(
        ' ',
        a.brg_jeniskaos,
        a.brg_tipe,
        a.brg_lengan,
        a.brg_jeniskain,
        a.brg_warna
      ) AS nama,

      b.brgd_ukuran AS ukuran,
      b.brgd_harga AS harga,

      IFNULL((
        SELECT SUM(m.mst_stok_in - m.mst_stok_out)
        FROM tmasterstok m
        WHERE m.mst_aktif = 'Y'
          AND m.mst_cab = ?
          AND m.mst_brg_kode = b.brgd_kode
          AND m.mst_ukuran = b.brgd_ukuran
      ), 0) AS stok

    ${fromClause}
    ${whereClause}

    ORDER BY nama, b.brgd_ukuran
    LIMIT ? OFFSET ?
  `;

  const dataParams = [gudang, ...params, itemsPerPage, offset];

  const [items] = await pool.query(dataQuery, dataParams);

  const [[{ total }]] = await pool.query(`
    SELECT FOUND_ROWS() AS total
  `);

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
  const { header, details, user, isNew } = data;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (isNew) {
      // 1A. Simpan Header Baru (Tambahkan bch_cab agar data lengkap)
      await connection.query(
        "INSERT INTO tbarcode_hdr (bch_nomor, bch_tanggal, bch_cab, user_create, date_create) VALUES (?, ?, ?, ?, NOW())",
        [header.nomor, header.tanggal, user.cabang, user.kode],
      );
    } else {
      // 1B. Update Header Lama
      // Perbaikan: user_edit -> user_modified, date_edit -> date_modified
      await connection.query(
        "UPDATE tbarcode_hdr SET bch_tanggal = ?, user_modified = ?, date_modified = NOW() WHERE bch_nomor = ?",
        [header.tanggal, user.kode, header.nomor],
      );

      // Hapus detail lama agar bisa diganti yang baru
      await connection.query("DELETE FROM tbarcode_dtl WHERE bcd_nomor = ?", [
        header.nomor,
      ]);
    }

    // 2. Simpan Detail
    for (const [index, detail] of details.entries()) {
      if (detail.kode && (detail.jumlah || 0) > 0) {
        await connection.query(
          "INSERT INTO tbarcode_dtl (bcd_nomor, bcd_kode, bcd_ukuran, bcd_jumlah, bcd_nourut) VALUES (?, ?, ?, ?, ?)",
          [header.nomor, detail.kode, detail.ukuran, detail.jumlah, index + 1],
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
    console.error("Error saving barcode:", error); // Tambahkan log error untuk debugging
    throw error;
  } finally {
    connection.release();
  }
};

const searchMaster = async (term, page, itemsPerPage) => {
  const offset = (page - 1) * itemsPerPage;

  let params = [];

  // ---------- SMART MULTI TOKEN ----------
  const tokens = (term || "")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  let whereClause = `WHERE a.brg_aktif = 0`;

  if (tokens.length > 0) {
    whereClause += " AND (";
    const parts = [];

    for (const t of tokens) {
      parts.push(`
        (
          LOWER(a.brg_kode) LIKE ?
          OR LOWER(a.brg_jeniskaos) LIKE ?
          OR LOWER(a.brg_tipe) LIKE ?
          OR LOWER(a.brg_lengan) LIKE ?
          OR LOWER(a.brg_jeniskain) LIKE ?
          OR LOWER(a.brg_warna) LIKE ?
          OR LOWER(
            TRIM(CONCAT(
              a.brg_jeniskaos, ' ',
              a.brg_tipe, ' ',
              a.brg_lengan, ' ',
              a.brg_jeniskain, ' ',
              a.brg_warna
            ))
          ) LIKE ?
        )
      `);

      const like = `%${t.toLowerCase()}%`;

      params.push(like, like, like, like, like, like, like);
    }

    // semua token HARUS match (AND antar token)
    whereClause += parts.join(" AND ");
    whereClause += ")";
  }

  // ---------- TOTAL ----------
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM tbarangdc a
    ${whereClause}
  `;
  const [countRows] = await pool.query(countQuery, params);
  const total = countRows[0]?.total ?? 0;

  // ---------- DATA ----------
  const dataQuery = `
    SELECT 
      a.brg_kode AS kode,
      TRIM(CONCAT(
        a.brg_jeniskaos, ' ',
        a.brg_tipe, ' ',
        a.brg_lengan, ' ',
        a.brg_jeniskain, ' ',
        a.brg_warna
      )) AS nama
    FROM tbarangdc a
    ${whereClause}
    ORDER BY nama
    LIMIT ${itemsPerPage} OFFSET ${offset}
  `;

  const [items] = await pool.query(dataQuery, params);

  return { items, total };
};

const findByBarcode = async (barcode) => {
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
