const pool = require("../config/database");

const loadAllStock = async (cabang) => {
  const query = `
        SELECT 
            x.kode, x.ukuran, x.stok,
            b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama
        FROM (
            SELECT mst_brg_kode AS kode, mst_ukuran AS ukuran, SUM(mst_stok_in - mst_stok_out) AS stok 
            FROM tmasterstok
            WHERE mst_aktif = 'Y' AND mst_cab = ?
            GROUP BY mst_brg_kode, mst_ukuran
        ) x
        LEFT JOIN tbarangdc a ON a.brg_kode = x.kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = x.kode AND b.brgd_ukuran = x.ukuran
        WHERE x.stok <> 0;
    `;
  const [rows] = await pool.query(query, [cabang]);
  return rows;
};

const getForEdit = async (nomor) => {
  const headerQuery = `SELECT rb_nomor AS nomor, rb_tanggal AS tanggal, rb_kecab, g.gdg_nama, rb_ket AS keterangan FROM trbdc_hdr h LEFT JOIN tgudang g ON g.gdg_kode = h.rb_kecab WHERE rb_nomor = ?`;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0) throw new Error("Dokumen tidak ditemukan.");
  const header = {
    nomor: headerRows[0].nomor,
    tanggal: headerRows[0].tanggal,
    gudangDc: { kode: headerRows[0].rb_kecab, nama: headerRows[0].gdg_nama },
    keterangan: headerRows[0].keterangan,
  };

  const gudangAsal = nomor.substring(0, 3);
  const itemsQuery = `
        SELECT
            d.rbd_kode AS kode, b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d.rbd_ukuran AS ukuran,
            d.rbd_jumlah AS jumlah,
            (IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif='Y' AND m.mst_cab=? AND m.mst_brg_kode=d.rbd_kode AND m.mst_ukuran=d.rbd_ukuran), 0) + d.rbd_jumlah) AS stok
        FROM trbdc_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.rbd_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.rbd_kode AND b.brgd_ukuran = d.rbd_ukuran
        WHERE d.rbd_nomor = ?`;
  const [items] = await pool.query(itemsQuery, [gudangAsal, nomor]);

  return { header, items };
};

const getProductDetails = async (filters) => {
  const { kode, ukuran, gudang } = filters;
  const query = `
        SELECT 
            b.brgd_kode AS kode, b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=? AND m.mst_ukuran=?), 0) AS stok
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
        WHERE a.brg_aktif = 0 AND b.brgd_kode = ? AND b.brgd_ukuran = ?;
    `;
  const [rows] = await pool.query(query, [gudang, kode, ukuran, kode, ukuran]);
  if (rows.length === 0) throw new Error("Detail produk tidak ditemukan");
  return rows[0];
};

const findByBarcode = async (barcode, gudang) => {
  const query = `
        SELECT 
            b.brgd_kode AS kode, b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=b.brgd_kode AND m.mst_ukuran=b.brgd_ukuran), 0) AS stok
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
        WHERE a.brg_aktif = 0 AND b.brgd_barcode = ?;
    `;
  const [rows] = await pool.query(query, [gudang, barcode]);
  if (rows.length === 0) throw new Error("Barcode tidak ditemukan.");
  return rows[0];
};

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
      const prefix = `${user.cabang}.RB.${yearMonth}.`;
      const nomorQuery = `SELECT IFNULL(MAX(RIGHT(rb_nomor, 4)), 0) + 1 AS next_num FROM trbdc_hdr WHERE LEFT(rb_nomor, 11) = ?;`;
      const [nomorRows] = await connection.query(nomorQuery, [prefix]);
      nomorDokumen = `${prefix}${nomorRows[0].next_num
        .toString()
        .padStart(4, "0")}`;

      await connection.query(
        "INSERT INTO trbdc_hdr (rb_nomor, rb_tanggal, rb_kecab, rb_ket, user_create, date_create) VALUES (?, ?, ?, ?, ?, NOW())",
        [
          nomorDokumen,
          header.tanggal,
          header.gudangDc.kode,
          header.keterangan,
          user.kode,
        ]
      );
    } else {
      await connection.query(
        "UPDATE trbdc_hdr SET rb_tanggal = ?, rb_kecab = ?, rb_ket = ?, user_modified = ?, date_modified = NOW() WHERE rb_nomor = ?",
        [
          header.tanggal,
          header.gudangDc.kode,
          header.keterangan,
          user.kode,
          nomorDokumen,
        ]
      );
    }

    await connection.query("DELETE FROM trbdc_dtl WHERE rbd_nomor = ?", [
      nomorDokumen,
    ]);

    if (items.length > 0) {
      const itemValues = items.map((item) => [
        nomorDokumen,
        item.kode,
        item.ukuran,
        item.jumlah,
      ]);
      await connection.query(
        "INSERT INTO trbdc_dtl (rbd_nomor, rbd_kode, rbd_ukuran, rbd_jumlah) VALUES ?",
        [itemValues]
      );
    }

    await connection.commit();
    return {
      message: `Retur Barang ke DC berhasil disimpan dengan nomor ${nomorDokumen}`,
      nomor: nomorDokumen,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const lookupGudangDc = async (filters) => {
  const { term, page: pageStr, itemsPerPage: itemsPerPageStr } = filters;
  const page = parseInt(pageStr, 10) || 1;
  const itemsPerPage = parseInt(itemsPerPageStr, 10) || 10;
  const offset = (page - 1) * itemsPerPage;
  const searchTerm = `%${term || ""}%`;

  let whereConditions = ["gdg_dc = 1"]; // <-- Logika utama: hanya gudang DC
  let params = [];

  if (term) {
    whereConditions.push(`(gdg_kode LIKE ? OR gdg_nama LIKE ?)`);
    params.push(searchTerm, searchTerm);
  }

  const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

  const countQuery = `SELECT COUNT(*) as total FROM tgudang ${whereClause}`;
  const [countRows] = await pool.query(countQuery, params);
  const total = countRows[0].total;

  const dataQuery = `
        SELECT gdg_kode AS kode, gdg_nama AS nama 
        FROM tgudang 
        ${whereClause}
        ORDER BY gdg_kode
        LIMIT ? OFFSET ?;
    `;
  const dataParams = [...params, itemsPerPage, offset];
  const [items] = await pool.query(dataQuery, dataParams);

  return { items, total };
};

const getPrintData = async (nomor) => {
  const query = `
        SELECT 
            h.rb_nomor, h.rb_tanggal, h.rb_ket,
            DATE_FORMAT(h.date_create, '%d-%m-%Y %H:%i:%s') AS created,
            h.user_create,
            d.rbd_kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama_barang,
            d.rbd_ukuran,
            d.rbd_jumlah,
            g_asal.gdg_nama AS dari_gudang,
            g_tujuan.gdg_nama AS ke_gudang,
            -- Ambil info perusahaan dari cabang asal
            g_asal.gdg_inv_nama,
            g_asal.gdg_inv_alamat,
            g_asal.gdg_inv_kota,
            g_asal.gdg_inv_telp
        FROM trbdc_hdr h
        LEFT JOIN trbdc_dtl d ON d.rbd_nomor = h.rb_nomor
        LEFT JOIN tgudang g_asal ON g_asal.gdg_kode = LEFT(h.rb_nomor, 3)
        LEFT JOIN tgudang g_tujuan ON g_tujuan.gdg_kode = h.rb_kecab
        LEFT JOIN tbarangdc a ON a.brg_kode = d.rbd_kode
        WHERE h.rb_nomor = ?;
    `;
  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) throw new Error("Data untuk dicetak tidak ditemukan.");

  const header = {
    nomor: rows[0].rb_nomor,
    tanggal: rows[0].rb_tanggal,
    keterangan: rows[0].rb_ket,
    created: rows[0].created,
    user_create: rows[0].user_create,
    dariStore: rows[0].dari_gudang,
    keGudang: rows[0].ke_gudang,
    // Info Perusahaan dari Cabang Asal
    perush_nama: rows[0].gdg_inv_nama,
    perush_alamat: `${rows[0].gdg_inv_alamat || ""}, ${
      rows[0].gdg_inv_kota || ""
    }`,
    perush_telp: rows[0].gdg_inv_telp,
  };
  const details = rows
    .filter((r) => r.rbd_kode)
    .map((r) => ({
      kode: r.rbd_kode,
      nama: r.nama_barang,
      ukuran: r.rbd_ukuran,
      jumlah: r.rbd_jumlah,
    }));

  return { header, details };
};

module.exports = {
  loadAllStock,
  save,
  getForEdit,
  getProductDetails,
  findByBarcode,
  lookupGudangDc,
  getPrintData,
};
