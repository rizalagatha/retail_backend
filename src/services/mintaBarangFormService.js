const pool = require("../config/database");
const { format } = require("date-fns");

const getSudah = async (connection, soNomor, kode, ukuran, excludeMtNomor) => {
  const query = `
    SELECT IFNULL(SUM(mtd_jumlah), 0) AS total 
    FROM tmintabarang_dtl
    JOIN tmintabarang_hdr ON mt_nomor = mtd_nomor
    WHERE mt_nomor <> ? AND mt_so = ? AND mtd_kode = ? AND mtd_ukuran = ?
  `;
  const [rows] = await connection.query(query, [
    excludeMtNomor || "",
    soNomor,
    kode,
    ukuran,
  ]);
  return rows[0].total;
};

const getSoDetailsForGrid = async (soNomor, user) => {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query(
      `
      SELECT 
        d.sod_kode AS kode, 
        IFNULL(b.brgd_barcode, '') AS barcode,
        TRIM(CONCAT(a.brg_jeniskaos,' ',a.brg_tipe,' ',a.brg_lengan,' ',a.brg_jeniskain,' ',a.brg_warna)) AS nama,
        d.sod_ukuran AS ukuran,

        IFNULL(b.brgd_min,0) AS stokmin,
        IFNULL(b.brgd_max,0) AS stokmax,

        -- STOK
        IFNULL((
          SELECT SUM(m.mst_stok_in - m.mst_stok_out)
          FROM tmasterstok m
          WHERE m.mst_aktif='Y'
            AND m.mst_cab=?
            AND m.mst_brg_kode=d.sod_kode
            AND m.mst_ukuran=d.sod_ukuran
        ),0) AS stok,

        -- SUDAH MINTA FORM INI DAN SEBELUMNYA BASED ON SO-NOMOR (INI YANG TEPAT)
        IFNULL((
          SELECT SUM(mtd.mtd_jumlah)
          FROM tmintabarang_hdr h2
          JOIN tmintabarang_dtl mtd ON mtd.mtd_nomor = h2.mt_nomor
          WHERE h2.mt_closing='N'
            AND h2.mt_so = d.sod_so_nomor
            AND mtd.mtd_kode = d.sod_kode
            AND mtd.mtd_ukuran = d.sod_ukuran
        ),0) AS sudahminta,

        -- SJ BELUM DITERIMA
        IFNULL((
          SELECT SUM(sjd.sjd_jumlah)
          FROM tdc_sj_hdr sh
          JOIN tdc_sj_dtl sjd ON sjd.sjd_nomor = sh.sj_nomor
          WHERE sh.sj_kecab=?
            AND sjd.sjd_kode=d.sod_kode
            AND sjd.sjd_ukuran=d.sod_ukuran
            AND sh.sj_noterima=''
        ), 0) AS sj,

        c.cus_kode,
        c.cus_nama,
        c.cus_alamat,
        d.sod_jumlah AS qtyso

      FROM tso_dtl d
      JOIN tso_hdr h ON d.sod_so_nomor = h.so_nomor
      LEFT JOIN tbarangdc a ON a.brg_kode = d.sod_kode
      LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sod_kode AND b.brgd_ukuran = d.sod_ukuran
      LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
      WHERE h.so_nomor = ?
      `,
      [user.cabang, user.cabang, soNomor]
    );

    const customer =
      rows.length > 0
        ? {
            kode: rows[0].cus_kode,
            nama: rows[0].cus_nama,
            alamat: rows[0].cus_alamat,
          }
        : null;

    const items = rows.map((r) => {
      const mino = r.stokmax - (r.stok + r.sudahminta + r.sj);
      return {
        ...r,
        mino: mino > 0 ? mino : 0,
        jumlah: mino > 0 ? mino : 0,
      };
    });

    return { items, customer };
  } finally {
    connection.release();
  }
};

const getProductDetailsForGrid = async (filters, user) => {
  const { kode, ukuran, barcode } = filters;
  const connection = await pool.getConnection();
  try {
    let query = `
        SELECT 
          b.brgd_kode AS kode,
          b.brgd_barcode AS barcode,
          IFNULL(TRIM(CONCAT(
            a.brg_jeniskaos, " ", a.brg_tipe, " ",
            a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna
          )), '') AS nama,
          b.brgd_ukuran AS ukuran,
          IFNULL(b.brgd_min, 0) AS stokmin,
          IFNULL(b.brgd_max, 0) AS stokmax,
          IFNULL((
            SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
            FROM tmasterstok m 
            WHERE m.mst_aktif="Y" AND m.mst_cab=? 
            AND m.mst_brg_kode=b.brgd_kode AND m.mst_ukuran=b.brgd_ukuran
          ), 0) AS stok,
          IFNULL((
            SELECT SUM(mtd.mtd_jumlah) 
            FROM tmintabarang_hdr mth 
            JOIN tmintabarang_dtl mtd ON mtd.mtd_nomor = mth.mt_nomor 
            WHERE mth.mt_closing='N' 
            AND mth.mt_cab = ?
            AND mtd.mtd_kode=b.brgd_kode 
            AND mtd.mtd_ukuran=b.brgd_ukuran 
            AND mth.mt_nomor NOT IN (
              SELECT sj_mt_nomor FROM tdc_sj_hdr WHERE sj_mt_nomor<>""
            )
          ), 0) AS sudahminta,
          IFNULL((
            SELECT SUM(sjd.sjd_jumlah) 
            FROM tdc_sj_hdr sjh 
            JOIN tdc_sj_dtl sjd ON sjd.sjd_nomor=sjh.sj_nomor 
            WHERE sjh.sj_kecab=? AND sjh.sj_noterima='' 
              AND sjd.sjd_kode=b.brgd_kode 
              AND sjd.sjd_ukuran=b.brgd_ukuran
            ), 0) AS sj
          FROM tbarangdc_dtl b
          JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
          WHERE a.brg_aktif = 0
      `;
    // Parameter untuk subquery di SELECT, perlu dipertahankan
    const params = [user.cabang, user.cabang, user.cabang];

    if (user.cabang === "K04") {
      query += ' AND a.brg_ktg <> ""';
    } else if (user.cabang === "K05") {
      query += ' AND a.brg_ktg = ""';
    }

    if (barcode) {
      query += ` AND b.brgd_barcode = ?`;
      params.push(barcode);
    } else {
      query += ` AND b.brgd_kode = ? AND b.brgd_ukuran = ?`;
      params.push(kode, ukuran);
    }

    const [rows] = await connection.query(query, params);
    if (rows.length === 0) {
      throw new Error(
        "Detail produk tidak ditemukan atau tidak valid untuk cabang ini."
      );
    }

    // Kalkulasi mino dan jumlah tetap sama
    const product = rows[0];
    const mino =
      product.stokmax - (product.stok + product.sudahminta + product.sj);
    product.mino = mino > 0 ? mino : 0;
    product.jumlah = product.mino;

    return product;
  } finally {
    connection.release();
  }
};

const getBufferStokItems = async (user) => {
  const connection = await pool.getConnection();
  try {
    const cab = user.cabang;

    const query = `
      SELECT 
        y.Kode,
        y.Barcode,
        y.Nama,
        y.Ukuran,
        y.StokMinimal AS stokmin,
        y.StokMaximal AS stokmax,
        y.sudahminta,
        y.sj,
        y.Stok AS stok,
        (y.StokMaximal - (y.Stok + y.sudahminta + y.sj)) AS mino
      FROM (
        SELECT
          x.Kode,
          x.Barcode,
          x.Nama,
          x.Ukuran,
          x.StokMinimal,
          x.StokMaximal,

          /* sudah minta */
          IFNULL((
            SELECT SUM(mtd.mtd_jumlah)
            FROM tmintabarang_hdr mth
            JOIN tmintabarang_dtl mtd ON mtd.mtd_nomor = mth.mt_nomor
            WHERE mth.mt_closing = 'N'
              AND mth.mt_cab = ?
              AND mtd.mtd_kode = x.Kode
              AND mtd.mtd_ukuran = x.Ukuran
              AND mth.mt_nomor NOT IN (
                SELECT sj_mt_nomor FROM tdc_sj_hdr WHERE sj_mt_nomor <> ''
              )
          ), 0) AS sudahminta,

          /* stok DC */
          IFNULL((
            SELECT SUM(mst_stok_in - mst_stok_out)
            FROM tmasterstok
            WHERE mst_aktif = 'Y'
              AND mst_cab = ?
              AND mst_brg_kode = x.Kode
              AND mst_ukuran = x.Ukuran
          ), 0) AS Stok,

          /* SJ belum diterima */
          IFNULL((
            SELECT SUM(sjd_jumlah)
            FROM tdc_sj_hdr sjh
            LEFT JOIN tdc_sj_dtl sjd ON sjd.sjd_nomor = sjh.sj_nomor
            WHERE sjh.sj_kecab = ?
              AND sjh.sj_noterima = ''
              AND sjh.sj_mt_nomor = ''
              AND sjd.sjd_kode = x.Kode
              AND sjd.sjd_ukuran = x.Ukuran
          ), 0) AS sj

        FROM (
          SELECT
            a.brg_kode AS Kode,
            TRIM(CONCAT(
              a.brg_jeniskaos, ' ',
              a.brg_tipe, ' ',
              a.brg_lengan, ' ',
              a.brg_jeniskain, ' ',
              a.brg_warna
            )) AS Nama,
            b.brgd_ukuran AS Ukuran,
            b.brgd_barcode AS Barcode,
            IFNULL(b.brgd_min, 0) AS StokMinimal,
            IFNULL(b.brgd_max, 0) AS StokMaximal
          FROM tbarangdc a
          JOIN tbarangdc_dtl b ON b.brgd_kode = a.brg_kode
          WHERE a.brg_aktif = 0
            AND a.brg_logstok = "Y"
            AND b.brgd_min <> 0
            AND a.brg_ktgp = "REGULER"
            ${cab === "K04" ? 'AND a.brg_ktg <> ""' : 'AND a.brg_ktg = ""'}
        ) x
      ) y
      WHERE (y.StokMinimal - (y.Stok + y.sudahminta + y.sj)) > 0
      ORDER BY y.Nama, y.Ukuran;
    `;

    const [rows] = await connection.query(query, [cab, cab, cab]);

    // Hitung 'jumlah' dan 'minta' default
    const items = rows.map((r, idx) => ({
      id: idx + 1,
      minta: false,
      kode: r.Kode,
      nama: r.Nama,
      ukuran: r.Ukuran,
      stokmin: r.stokmin,
      stokmax: r.stokmax,
      stok: r.stok,
      sudahminta: r.sudahminta,
      sj: r.sj,
      mino: r.mino,
      jumlah: r.mino > 0 ? r.mino : 0,
      barcode: r.Barcode,
    }));

    return items;
  } finally {
    connection.release();
  }
};

/**
 * @description Menyimpan data Minta Barang (baru atau ubah).
 */
const save = async (data, user) => {
  const { header, items, isNew } = data;
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    let mtNomor = header.nomor;
    let idrec;

    const customerKode = header?.customer?.kode
      ? String(header.customer.kode)
      : "";

    if (isNew) {
      // Logika getmaxnomor dari Delphi
      const prefix = `${user.cabang}MT${format(
        new Date(header.tanggal),
        "yyMM"
      )}`;
      const [maxRows] = await connection.query(
        `SELECT IFNULL(MAX(RIGHT(mt_nomor, 4)), 0) as maxNum FROM tmintabarang_hdr WHERE LEFT(mt_nomor, 9) = ?`,
        [prefix]
      );
      const nextNum = parseInt(maxRows[0].maxNum, 10) + 1;
      mtNomor = `${prefix}${String(10000 + nextNum).slice(1)}`;
      idrec = `${user.cabang}MT${format(new Date(), "yyyyMMddHHmmssSSS")}`;

      const insertHeaderQuery = `
        INSERT INTO tmintabarang_hdr 
        (mt_idrec, mt_nomor, mt_tanggal, mt_so, mt_cus, mt_ket, mt_cab, user_create, date_create)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())  
      `;
      await connection.query(insertHeaderQuery, [
        idrec,
        mtNomor,
        header.tanggal,
        header.soNomor,
        customerKode,
        header.keterangan,
        user.cabang,
        user.kode,
      ]);
    } else {
      const [idrecRows] = await connection.query(
        "SELECT mt_idrec FROM tmintabarang_hdr WHERE mt_nomor = ?",
        [mtNomor]
      );
      if (idrecRows.length === 0)
        throw new Error("Nomor Minta Barang tidak ditemukan.");
      idrec = idrecRows[0].mt_idrec;

      const updateHeaderQuery = `
        UPDATE tmintabarang_hdr SET
          mt_tanggal=?,
          mt_so=?,
          mt_cus=?,
          mt_ket=?,
          user_modified=?,
          date_modified=NOW()
        WHERE mt_nomor=? AND mt_cab=?
      `;
      await connection.query(updateHeaderQuery, [
        header.tanggal,
        header.soNomor,
        customerKode,
        header.keterangan,
        user.kode,
        mtNomor,
        user.cabang,
      ]);
    }

    // Pola "hapus-lalu-sisipkan" untuk detail
    await connection.query("DELETE FROM tmintabarang_dtl WHERE mtd_nomor = ?", [
      mtNomor,
    ]);

    const validItems = items.filter(
      (item) => item.kode && (item.jumlah || 0) > 0
    );
    for (const item of validItems) {
      await connection.query(
        "INSERT INTO tmintabarang_dtl (mtd_idrec, mtd_nomor, mtd_kode, mtd_ukuran, mtd_jumlah) VALUES (?, ?, ?, ?, ?)",
        [idrec, mtNomor, item.kode, item.ukuran, item.jumlah]
      );
    }

    await connection.commit();
    return {
      message: `Permintaan Barang ${mtNomor} berhasil disimpan.`,
      nomor: mtNomor,
    };
  } catch (error) {
    await connection.rollback();
    console.error("Save Minta Barang Error:", error);
    throw new Error("Gagal menyimpan Permintaan Barang.");
  } finally {
    connection.release();
  }
};

const loadForEdit = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    // Query ini adalah migrasi dari 'loaddataall' di Delphi
    const query = `
      SELECT 
        h.mt_nomor, h.mt_tanggal, h.mt_so, h.mt_cus, h.mt_ket,
        c.cus_nama, c.cus_alamat,
        d.mtd_kode, d.mtd_ukuran, d.mtd_jumlah,
        b.brgd_barcode, 
        IFNULL(b.brgd_min, 0) AS stokmin, 
        IFNULL(b.brgd_max, 0) AS stokmax,
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
        IFNULL((
          SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m
          WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=d.mtd_kode AND m.mst_ukuran=d.mtd_ukuran
        ), 0) AS stok,
        IFNULL((
          SELECT SUM(prev_mtd.mtd_jumlah) FROM tmintabarang_hdr prev_mth
          JOIN tmintabarang_dtl prev_mtd ON prev_mtd.mtd_nomor = prev_mth.mt_nomor
          WHERE prev_mth.mt_closing='N' AND prev_mth.mt_nomor <> ? AND prev_mth.mt_so = h.mt_so
            AND prev_mtd.mtd_kode = d.mtd_kode AND prev_mtd.mtd_ukuran = d.mtd_ukuran
        ), 0) AS sudahminta,
        IFNULL((
          SELECT SUM(sjd.sjd_jumlah) FROM tdc_sj_hdr sjh
          JOIN tdc_sj_dtl sjd ON sjd.sjd_nomor = sjh.sj_nomor
          WHERE sjh.sj_kecab=? AND sjh.sj_noterima='' 
            AND sjd.sjd_kode = d.mtd_kode AND sjd.sjd_ukuran = d.mtd_ukuran
        ), 0) AS sj
        FROM tmintabarang_hdr h
        LEFT JOIN tmintabarang_dtl d ON d.mtd_nomor = h.mt_nomor
        LEFT JOIN tbarangdc a ON a.brg_kode = d.mtd_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.mtd_kode AND b.brgd_ukuran = d.mtd_ukuran
        LEFT JOIN tcustomer c ON c.cus_kode = h.mt_cus
        WHERE h.mt_nomor = ? AND h.mt_cab = ?
      `;
    const [rows] = await connection.query(query, [
      user.cabang,
      nomor,
      user.cabang,
      nomor,
      user.cabang,
    ]);
    if (rows.length === 0) {
      throw new Error("Data Permintaan Barang tidak ditemukan.");
    }

    // Proses dan format data untuk dikirim ke frontend
    const header = {
      nomor: rows[0].mt_nomor,
      tanggal: rows[0].mt_tanggal,
      soNomor: rows[0].mt_so,
      customer: {
        kode: rows[0].mt_cus,
        nama: rows[0].cus_nama,
        alamat: rows[0].cus_alamat,
      },
      keterangan: rows[0].mt_ket,
    };

    const items = rows.map((row) => {
      const mino = row.stokmax - (row.stok + row.sudahminta + row.sj);
      return {
        kode: row.mtd_kode,
        nama: row.nama,
        ukuran: row.mtd_ukuran,
        stokmin: row.stokmin,
        stokmax: row.stokmax,
        sudahminta: row.sudahminta,
        sj: row.sj,
        stok: row.stok,
        mino: mino > 0 ? mino : 0,
        jumlah: row.mtd_jumlah,
        barcode: row.brgd_barcode,
      };
    });

    return { header, items };
  } finally {
    connection.release();
  }
};

const findByBarcode = async (barcode, cabang) => {
  const query = `
    SELECT
      d.brgd_barcode AS barcode,
      d.brgd_kode AS kode,
      TRIM(CONCAT(
        h.brg_jeniskaos, " ", h.brg_tipe, " ",
        h.brg_lengan, " ", h.brg_jeniskain, " ", h.brg_warna
      )) AS nama,
      d.brgd_ukuran AS ukuran,
      d.brgd_harga AS harga,

      IFNULL(d.brgd_min, 0) AS stokmin,
      IFNULL(d.brgd_max, 0) AS stokmax,

      -- STOK
      IFNULL((
        SELECT SUM(m.mst_stok_in - m.mst_stok_out)
        FROM tmasterstok m
        WHERE m.mst_aktif='Y'
          AND m.mst_cab=?
          AND m.mst_brg_kode=d.brgd_kode
          AND m.mst_ukuran=d.brgd_ukuran
      ), 0) AS stok,

      -- SUDAH MINTA FORM MINTA BARANG (Belum Closing)
      IFNULL((
        SELECT SUM(mtd.mtd_jumlah)
        FROM tmintabarang_hdr hdr
        JOIN tmintabarang_dtl mtd ON mtd.mtd_nomor = hdr.mt_nomor
        WHERE hdr.mt_closing='N'
          AND hdr.mt_cab=?
          AND mtd.mtd_kode=d.brgd_kode
          AND mtd.mtd_ukuran=d.brgd_ukuran
          AND hdr.mt_nomor NOT IN (
            SELECT sj_mt_nomor FROM tdc_sj_hdr WHERE sj_mt_nomor <> ""
          )
      ), 0) AS sudahminta,

      -- SJ Belum Diterima
      IFNULL((
        SELECT SUM(sjd.sjd_jumlah)
        FROM tdc_sj_hdr sjh
        JOIN tdc_sj_dtl sjd ON sjd.sjd_nomor = sjh.sj_nomor
        WHERE sjh.sj_kecab=?
          AND sjh.sj_noterima=''
          AND sjd.sjd_kode=d.brgd_kode
          AND sjd.sjd_ukuran=d.brgd_ukuran
      ), 0) AS sj

    FROM tbarangdc_dtl d
    LEFT JOIN tbarangdc h ON h.brg_kode=d.brgd_kode
    WHERE h.brg_aktif=0
      AND h.brg_logstok <> 'N'
      AND d.brgd_barcode = ?;
  `;

  const [rows] = await pool.query(query, [cabang, cabang, cabang, barcode]);
  if (!rows.length) throw new Error("Barcode tidak ditemukan.");

  const p = rows[0];

  // Hitung mino & jumlah
  const mino = p.stokmax - (p.stok + p.sudahminta + p.sj);
  p.mino = mino > 0 ? mino : 0;
  p.jumlah = p.mino;

  return p;
};

const lookupProducts = async (filters) => {
  const page = parseInt(filters.page, 10) || 1;
  const itemsPerPage = parseInt(filters.itemsPerPage, 10) || 10;
  const { term } = filters;
  const gudang = filters.gudang; // <-- penting

  const offset = (page - 1) * itemsPerPage;
  const searchTerm = term ? `%${term}%` : null;

  let fromClause = `
        FROM tbarangdc a
        INNER JOIN tbarangdc_dtl b ON a.brg_kode = b.brgd_kode
    `;

  let whereClause = `WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'`;
  let params = [];

  if (term) {
    whereClause += `
      AND (a.brg_kode LIKE ?
      OR b.brgd_barcode LIKE ?
      OR TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ",
         a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) LIKE ?)`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  // COUNT QUERY
  const countQuery = `SELECT COUNT(*) as total ${fromClause} ${whereClause}`;
  const [countRows] = await pool.query(countQuery, params);
  const total = countRows[0].total;

  // DATA QUERY — FIXED VERSION
  const dataQuery = `
    SELECT
      b.brgd_kode AS kode,
      b.brgd_barcode AS barcode,
      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ",
        a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
      b.brgd_ukuran AS ukuran,
      b.brgd_harga AS harga,
      a.brg_ktg AS kategori,

      IFNULL((
        SELECT SUM(m.mst_stok_in - m.mst_stok_out)
        FROM tmasterstok m
        WHERE m.mst_aktif = 'Y'
          AND m.mst_cab = ?
          AND m.mst_brg_kode = b.brgd_kode
          AND m.mst_ukuran = b.brgd_ukuran
        ), 0) AS stok,

        CONCAT(b.brgd_kode, '-', b.brgd_ukuran) AS uniqueId

      ${fromClause}
      ${whereClause}
      ORDER BY nama, b.brgd_ukuran
      LIMIT ? OFFSET ?
    `;

  params = [gudang, ...params, itemsPerPage, offset];

  const [items] = await pool.query(dataQuery, params);
  return { items, total };
};

module.exports = {
  getSoDetailsForGrid,
  getBufferStokItems,
  save,
  loadForEdit,
  getProductDetailsForGrid,
  findByBarcode,
  lookupProducts,
};
