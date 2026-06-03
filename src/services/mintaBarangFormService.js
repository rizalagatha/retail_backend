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
      [user.cabang, user.cabang, soNomor],
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
        "Detail produk tidak ditemukan atau tidak valid untuk cabang ini.",
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

  // [FIX 1] Hanya validasi tanggal hari ini jika data BARU
  if (isNew) {
    const serverDate = format(new Date(), "yyyy-MM-dd");
    // [FIX 2] Ambil 10 karakter pertama untuk menghindari pergeseran timezone (mundur sehari)
    const inputDate =
      typeof header.tanggal === "string"
        ? header.tanggal.substring(0, 10)
        : format(new Date(header.tanggal), "yyyy-MM-dd");

    if (inputDate !== serverDate) {
      throw new Error(
        `Gagal Simpan: Tanggal transaksi (${inputDate}) harus hari ini (${serverDate}).`,
      );
    }
  }

  const totalQty = items.reduce(
    (sum, item) => sum + (Number(item.jumlah) || 0),
    0,
  );

  // [LOGIKA BARU] Abaikan limit jika cabang user adalah KPR
  if (user.cabang !== "KPR" && totalQty > 120) {
    throw new Error(
      `Gagal Simpan: Total permintaan (${totalQty}) melebihi batas maksimal 120 pcs.`,
    );
  }

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
        "yyMM",
      )}`;
      const [maxRows] = await connection.query(
        `SELECT IFNULL(MAX(RIGHT(mt_nomor, 4)), 0) as maxNum FROM tmintabarang_hdr WHERE LEFT(mt_nomor, 9) = ?`,
        [prefix],
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
        [mtNomor],
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
      (item) => item.kode && (item.jumlah || 0) > 0,
    );
    for (const item of validItems) {
      // 1. Insert ke tabel detail minta barang
      await connection.query(
        "INSERT INTO tmintabarang_dtl (mtd_idrec, mtd_nomor, mtd_kode, mtd_ukuran, mtd_jumlah) VALUES (?, ?, ?, ?, ?)",
        [idrec, mtNomor, item.kode, item.ukuran, item.jumlah],
      );

      // 2. [KODE BARU] Update status alokasi jika item ini berasal dari hasil convert modal
      if (item.alokasi_id) {
        await connection.query(
          "UPDATE tminta_alokasi SET status = 'PROCESSED' WHERE id = ?",
          [item.alokasi_id],
        );
      }
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
  const gudang = filters.gudang;

  const offset = (page - 1) * itemsPerPage;

  // ---------- BASE CLAUSE ----------
  let fromClause = `
    FROM tbarangdc a
    INNER JOIN tbarangdc_dtl b 
      ON a.brg_kode = b.brgd_kode
  `;

  let whereClause = `
    WHERE a.brg_aktif = 0
      AND a.brg_logstok = 'Y'
  `;

  // semua parameter query disimpan disini
  let params = [];

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
          a.brg_kode LIKE ?
          OR b.brgd_barcode LIKE ?
          OR TRIM(CONCAT(
            a.brg_jeniskaos, ' ',
            a.brg_tipe, ' ',
            a.brg_lengan, ' ',
            a.brg_jeniskain, ' ',
            a.brg_warna
          )) LIKE ?
        )
      `);

      const like = `%${t}%`;
      params.push(like, like, like);
    }

    // semua token wajib match
    whereClause += parts.join(" AND ");
    whereClause += ")";
  }

  // ---------- COUNT QUERY ----------
  const countQuery = `
    SELECT COUNT(*) AS total
    ${fromClause}
    ${whereClause}
  `;

  const [countRows] = await pool.query(countQuery, params);
  const total = countRows[0].total;

  // ---------- DATA QUERY ----------
  const dataQuery = `
    SELECT
      b.brgd_kode AS kode,
      b.brgd_barcode AS barcode,

      TRIM(CONCAT(
        a.brg_jeniskaos, ' ',
        a.brg_tipe, ' ',
        a.brg_lengan, ' ',
        a.brg_jeniskain, ' ',
        a.brg_warna
      )) AS nama,

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

  // param urutannya harus benar:
  // 1. gudang untuk stok
  // 2. semua params pencarian
  // 3. limit
  // 4. offset
  const dataParams = [gudang, ...params, itemsPerPage, offset];

  const [items] = await pool.query(dataQuery, dataParams);

  return { items, total };
};

const generateAutomasiMintaBarang = async (user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const today = format(new Date(), "yyyy-MM-dd");

    // =========================================================================
    // 1. CEK DUPLIKASI HARIAN
    // =========================================================================
    const [cekGenerate] = await connection.query(
      `SELECT 1 FROM tminta_alokasi WHERE tanggal = ? LIMIT 1`,
      [today],
    );
    if (cekGenerate.length > 0) {
      throw new Error(
        "Automasi Minta Barang untuk hari ini sudah pernah dijalankan.",
      );
    }

    // =========================================================================
    // 2. FETCH DATA MENTAH
    // =========================================================================

    // A. Ambil Config Buffer PER CABANG dari tbarangdc_dtl2 (Khusus K03 & K11)
    const [storeBuffers] = await connection.query(`
      SELECT 
        b2.brgd_cab AS cabang, 
        b2.brgd_kode AS kode, 
        b2.brgd_ukuran AS ukuran, 
        b2.brgd_min AS stokmin, 
        b2.brgd_max AS stokmax
      FROM tbarangdc_dtl2 b2
      JOIN tbarangdc a ON a.brg_kode = b2.brgd_kode
      JOIN tgudang g ON g.gdg_kode = b2.brgd_cab
      WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y' 
        AND b2.brgd_min > 0 
        AND g.gdg_kode IN ('K03', 'K11')
    `);

    // B. Ambil Stok Fisik Seluruh Toko
    const [stokToko] = await connection.query(`
      SELECT mst_cab AS cabang, mst_brg_kode AS kode, mst_ukuran AS ukuran, SUM(mst_stok_in - mst_stok_out) AS stok
      FROM tmasterstok 
      WHERE mst_aktif = 'Y' AND mst_cab <> 'KDC'
      GROUP BY mst_cab, mst_brg_kode, mst_ukuran
    `);

    // C. Ambil Permintaan Gantung
    const [sudahMinta] = await connection.query(`
      SELECT mth.mt_cab AS cabang, mtd.mtd_kode AS kode, mtd.mtd_ukuran AS ukuran, SUM(mtd.mtd_jumlah) AS qty
      FROM tmintabarang_hdr mth
      JOIN tmintabarang_dtl mtd ON mtd.mtd_nomor = mth.mt_nomor
      WHERE mth.mt_closing = 'N' AND mth.mt_nomor NOT IN (SELECT sj_mt_nomor FROM tdc_sj_hdr WHERE sj_mt_nomor <> '')
      GROUP BY mth.mt_cab, mtd.mtd_kode, mtd.mtd_ukuran
    `);

    // D. Ambil Packing List Gantung
    const [plGantung] = await connection.query(`
      SELECT plh.pl_cab_tujuan AS cabang, pld.pld_kode AS kode, pld.pld_ukuran AS ukuran, SUM(pld.pld_jumlah) AS qty
      FROM tpacking_list_hdr plh
      JOIN tpacking_list_dtl pld ON pld.pld_nomor = plh.pl_nomor
      WHERE plh.pl_status = 'O'
      GROUP BY plh.pl_cab_tujuan, pld.pld_kode, pld.pld_ukuran
    `);

    // E. Ambil Surat Jalan Gantung
    const [sjGantung] = await connection.query(`
      SELECT sjh.sj_kecab AS cabang, sjd.sjd_kode AS kode, sjd.sjd_ukuran AS ukuran, SUM(sjd.sjd_jumlah) AS qty
      FROM tdc_sj_hdr sjh
      JOIN tdc_sj_dtl sjd ON sjd.sjd_nomor = sjh.sj_nomor
      WHERE sjh.sj_noterima = '' AND sjh.sj_mt_nomor = ''
      GROUP BY sjh.sj_kecab, sjd.sjd_kode, sjd.sjd_ukuran
    `);

    // F. [BARU] Ambil Stok DC (Pusat)
    const [stokDc] = await connection.query(`
      SELECT mst_brg_kode AS kode, mst_ukuran AS ukuran, SUM(mst_stok_in - mst_stok_out) AS stok
      FROM tmasterstok 
      WHERE mst_aktif = 'Y' AND mst_cab = 'KDC'
      GROUP BY mst_brg_kode, mst_ukuran
    `);

    // =========================================================================
    // 3. MAPPING HASH MAP
    // =========================================================================
    const makeKey = (c, k, u) => `${c}|${k}|${u}`;
    const makeKeyDc = (k, u) => `${k}|${u}`; // Key khusus DC tanpa cabang

    const mapStokToko = new Map(
      stokToko.map((r) => [
        makeKey(r.cabang, r.kode, r.ukuran),
        Number(r.stok),
      ]),
    );
    const mapMinta = new Map(
      sudahMinta.map((r) => [
        makeKey(r.cabang, r.kode, r.ukuran),
        Number(r.qty),
      ]),
    );
    const mapPl = new Map(
      plGantung.map((r) => [
        makeKey(r.cabang, r.kode, r.ukuran),
        Number(r.qty),
      ]),
    );
    const mapSj = new Map(
      sjGantung.map((r) => [
        makeKey(r.cabang, r.kode, r.ukuran),
        Number(r.qty),
      ]),
    );
    const mapStokDc = new Map(
      stokDc.map((r) => [makeKeyDc(r.kode, r.ukuran), Number(r.stok)]),
    );

    // =========================================================================
    // 4. HITUNG DEMAND DAN PISAHKAN JALUR NORMAL VS JALUR KOSONG
    // =========================================================================
    const autoMintaNormal = {}; // Untuk Stok DC > 10
    const autoMintaKosong = {}; // Untuk Stok DC <= 10

    for (const buf of storeBuffers) {
      const k = makeKey(buf.cabang, buf.kode, buf.ukuran);
      const stokFisik = mapStokToko.get(k) || 0;
      const minta = mapMinta.get(k) || 0;
      const pl = mapPl.get(k) || 0;
      const sj = mapSj.get(k) || 0;

      const stokEfektif = stokFisik + minta + pl + sj;

      // SYARAT RESTOCK: Stok efektif di bawah MIN
      if (stokEfektif < buf.stokmin && buf.stokmin > 0) {
        const mino = buf.stokmax - stokEfektif; // Kebutuhan sampai MAX

        if (mino > 0) {
          // CEK STOK DC
          const dcKey = makeKeyDc(buf.kode, buf.ukuran);
          const currentDcStock = mapStokDc.get(dcKey) || 0;

          const payload = { kode: buf.kode, ukuran: buf.ukuran, mino: mino };

          if (currentDcStock > 10) {
            // Masuk Jalur Normal
            if (!autoMintaNormal[buf.cabang]) autoMintaNormal[buf.cabang] = [];
            autoMintaNormal[buf.cabang].push(payload);
          } else {
            // Masuk Jalur Kosong
            if (!autoMintaKosong[buf.cabang]) autoMintaKosong[buf.cabang] = [];
            autoMintaKosong[buf.cabang].push(payload);
          }
        }
      }
    }

    // =========================================================================
    // 5. INSERT DATABASE
    // =========================================================================
    const maxNumberMap = {};
    const timestampRec = format(new Date(), "yyyyMMddHHmmssSSS");
    let autoDocsCount = 0;

    // Helper untuk generate nomor dokumen
    const getNextNomor = async (cabangTarget) => {
      const prefix = `${cabangTarget}MT${format(new Date(), "yyMM")}`;
      if (maxNumberMap[prefix] === undefined) {
        const [maxRows] = await connection.query(
          `SELECT IFNULL(MAX(RIGHT(mt_nomor, 4)), 0) as maxNum FROM tmintabarang_hdr WHERE LEFT(mt_nomor, 9) = ?`,
          [prefix],
        );
        maxNumberMap[prefix] = parseInt(maxRows[0].maxNum, 10);
      }
      maxNumberMap[prefix]++;
      const mtNomor = `${prefix}${String(10000 + maxNumberMap[prefix]).slice(1)}`;
      const idrec = `${cabangTarget}MT${timestampRec}${String(maxNumberMap[prefix]).slice(-3)}`;
      return { mtNomor, idrec };
    };

    // --- 5A. INSERT JALUR NORMAL (Limit 120 Pcs per Dokumen) ---
    for (const [cabang, items] of Object.entries(autoMintaNormal)) {
      const chunks = [];
      let currentChunk = [];
      let currentSum = 0;
      const MAX_QTY_PER_DOC = 120;

      // Algoritma Pemecah Keranjang
      for (const item of items) {
        let remainingQty = item.mino;
        while (remainingQty > 0) {
          let spaceLeft = MAX_QTY_PER_DOC - currentSum;
          if (spaceLeft === 0) {
            chunks.push(currentChunk);
            currentChunk = [];
            currentSum = 0;
            spaceLeft = MAX_QTY_PER_DOC;
          }
          let qtyToTake = Math.min(remainingQty, spaceLeft);
          currentChunk.push({
            kode: item.kode,
            ukuran: item.ukuran,
            mino: qtyToTake,
          });
          currentSum += qtyToTake;
          remainingQty -= qtyToTake;
        }
      }
      if (currentChunk.length > 0) chunks.push(currentChunk);

      // Eksekusi Insert Normal
      for (const chunk of chunks) {
        const { mtNomor, idrec } = await getNextNomor(cabang);

        await connection.query(
          `INSERT INTO tmintabarang_hdr 
           (mt_idrec, mt_nomor, mt_tanggal, mt_so, mt_cus, mt_cab, mt_ket, mt_otomatis, user_create, date_create) 
           VALUES (?, ?, NOW(), '', '', ?, 'AUTO REPLENISHMENT', 'Y', ?, NOW())`,
          [idrec, mtNomor, cabang, user.kode],
        );

        const dtlValues = chunk.map((c) => [
          idrec,
          mtNomor,
          c.kode,
          c.ukuran,
          c.mino,
        ]);
        await connection.query(
          `INSERT INTO tmintabarang_dtl (mtd_idrec, mtd_nomor, mtd_kode, mtd_ukuran, mtd_jumlah) VALUES ?`,
          [dtlValues],
        );
        autoDocsCount++;
      }
    }

    // --- 5B. INSERT JALUR KOSONG (1 Dokumen Utuh per Cabang tanpa Limit) ---
    for (const [cabang, items] of Object.entries(autoMintaKosong)) {
      if (items.length === 0) continue;

      const { mtNomor, idrec } = await getNextNomor(cabang);

      // Keterangan khusus untuk dokumen ini
      await connection.query(
        `INSERT INTO tmintabarang_hdr 
         (mt_idrec, mt_nomor, mt_tanggal, mt_so, mt_cus, mt_cab, mt_ket, mt_otomatis, user_create, date_create) 
         VALUES (?, ?, NOW(), '', '', ?, 'AUTO REPLENISHMENT - STOK DC KOSONG', 'Y', ?, NOW())`,
        [idrec, mtNomor, cabang, user.kode],
      );

      const dtlValues = items.map((c) => [
        idrec,
        mtNomor,
        c.kode,
        c.ukuran,
        c.mino,
      ]);
      await connection.query(
        `INSERT INTO tmintabarang_dtl (mtd_idrec, mtd_nomor, mtd_kode, mtd_ukuran, mtd_jumlah) VALUES ?`,
        [dtlValues],
      );
      autoDocsCount++;
    }

    // Insert log ke tminta_alokasi (Optional, agar besok jalan lagi)
    await connection.query(
      `INSERT INTO tminta_alokasi (tanggal, cabang) VALUES (?, ?)`,
      [today, user.cabang],
    );

    await connection.commit();

    return {
      message: `Berhasil! ${autoDocsCount} Dokumen Minta Barang berhasil di-generate.`,
      jalur_hijau_docs: autoDocsCount,
      jalur_kuning_items: 0,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// A. Ambil data dengan JOIN ke tbarangdc agar nama barang muncul
const getPendingAlokasi = async (cabang) => {
  const query = `
    SELECT 
        a.id, a.tanggal, a.cabang, a.kode, a.ukuran, a.urgensi, a.qty_kebutuhan, a.qty_alokasi,
        TRIM(CONCAT(b.brg_jeniskaos, ' ', b.brg_tipe, ' ', b.brg_lengan, ' ', b.brg_jeniskain, ' ', b.brg_warna)) as nama
    FROM tminta_alokasi a
    JOIN tbarangdc b ON a.kode = b.brg_kode
    WHERE a.cabang = ? AND a.status = 'PENDING'
  `;
  const [rows] = await pool.query(query, [cabang]);
  return rows;
};

// ====================================================================
// FUNGSI BARU UNTUK CONVERT ALOKASI DI FORM CREATE
// ====================================================================
const getAlokasiDetailByIds = async (ids) => {
  const query = `
    SELECT 
        a.id as alokasi_id, a.kode, a.ukuran, a.qty_alokasi,
        TRIM(CONCAT(IFNULL(b.brg_jeniskaos, ''), ' ', IFNULL(b.brg_tipe, ''), ' ', IFNULL(b.brg_lengan, ''), ' ', IFNULL(b.brg_jeniskain, ''), ' ', IFNULL(b.brg_warna, ''))) as nama,
        (SELECT brgd_harga FROM tbarangdc_dtl WHERE brgd_kode = a.kode AND brgd_ukuran = a.ukuran LIMIT 1) as harga
    FROM tminta_alokasi a
    JOIN tbarangdc b ON a.kode = b.brg_kode
    WHERE a.id IN (?)
  `;
  const [rows] = await pool.query(query, [ids]);
  return rows;
};

module.exports = {
  getSoDetailsForGrid,
  getBufferStokItems,
  save,
  loadForEdit,
  getProductDetailsForGrid,
  findByBarcode,
  lookupProducts,
  generateAutomasiMintaBarang,
  getPendingAlokasi,
  getAlokasiDetailByIds,
};
