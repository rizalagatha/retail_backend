const pool = require("../config/database");
const { format } = require("date-fns");

const getNomor = async (connection, prefix, table, column) => {
  const tgl = new Date();
  const formattedPrefix = `${prefix}.SJ.${format(tgl, "yyMM")}`;
  const query = `SELECT IFNULL(MAX(RIGHT(${column}, 4)), 0) as max_nomor FROM ${table} WHERE LEFT(${column}, 11) = ?`;
  const [rows] = await connection.query(query, [formattedPrefix]);
  const nextNumber = parseInt(rows[0].max_nomor, 10) + 1;
  return `${formattedPrefix}.${String(nextNumber).padStart(4, "0")}`;
};

const getNomorTerima = async (connection, prefix, table, column) => {
  const tgl = new Date();
  const formattedPrefix = `${prefix}.TJ.${format(tgl, "yyMM")}`;
  const query = `SELECT IFNULL(MAX(RIGHT(${column}, 4)), 0) as max_nomor FROM ${table} WHERE LEFT(${column}, 11) = ?`;
  const [rows] = await connection.query(query, [formattedPrefix]);
  const nextNumber = parseInt(rows[0].max_nomor, 10) + 1;
  return `${formattedPrefix}.${String(nextNumber).padStart(4, "0")}`;
};

const getDataForEdit = async (nomor) => {
  const headerQuery = `
        SELECT 
            h.sj_nomor AS nomor,
            h.sj_tanggal AS tanggal,
            h.sj_noterima AS nomorTerima,
            LEFT(h.sj_nomor, 3) AS gudangKode,
            g.gdg_nama AS gudangNama,
            h.sj_kecab AS storeKode,
            o.gdg_nama AS storeNama,
            h.sj_peminta AS peminta
        FROM tdc_sj_hdr h
        LEFT JOIN retail.tgudang g ON g.gdg_kode = LEFT(h.sj_nomor, 3)
        LEFT JOIN retail.tgudang o ON o.gdg_kode = h.sj_kecab
        WHERE h.sj_nomor = ?;
    `;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0) throw new Error("Data tidak ditemukan.");

  const itemsQuery = `
        SELECT
            d.sjd_kode AS kode,
            b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d.sjd_ukuran AS ukuran,
            d.sjd_jumlah AS jumlah,
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                FROM retail.tmasterstok m 
                WHERE m.mst_aktif = "Y" AND m.mst_cab = LEFT(?, 3) AND m.mst_brg_kode = d.sjd_kode AND m.mst_ukuran = d.sjd_ukuran
            ), 0) + d.sjd_jumlah AS stok
        FROM tdc_sj_dtl d
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.sjd_kode
        LEFT JOIN retail.tbarangdc_dtl b ON b.brgd_kode = d.sjd_kode AND b.brgd_ukuran = d.sjd_ukuran
        WHERE d.sjd_nomor = ?;
    `;
  const [itemsRows] = await pool.query(itemsQuery, [nomor, nomor]);

  return { header: headerRows[0], items: itemsRows };
};

const saveData = async (payload, user) => {
  const { header, items } = payload;
  const isEdit = !!header.nomor;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let nomorSJ = header.nomor;
    let nomorTerima = header.nomorTerima;

    if (isEdit) {
      // UPDATE HEADER
      await connection.query(
        `UPDATE tdc_sj_hdr SET sj_tanggal = ?, sj_peminta = ?, user_modified = ?, date_modified = NOW() WHERE sj_nomor = ?`,
        [header.tanggal, header.peminta, user.id, nomorSJ]
      );
      // HAPUS DETAIL LAMA
      await connection.query(`DELETE FROM tdc_sj_dtl WHERE sjd_nomor = ?`, [
        nomorSJ,
      ]);
      await connection.query(
        `DELETE FROM retail.ttrm_sj_dtl WHERE tjd_nomor = ?`,
        [nomorTerima]
      );
    } else {
      // BUAT HEADER BARU
      nomorSJ = await getNomor(
        connection,
        header.gudangKode,
        "tdc_sj_hdr",
        "sj_nomor"
      );
      nomorTerima = await getNomorTerima(
        connection,
        header.storeKode,
        "retail.ttrm_sj_hdr",
        "tj_nomor"
      );

      await connection.query(
        `INSERT INTO tdc_sj_hdr (sj_nomor, sj_tanggal, sj_noterima, sj_kecab, sj_peminta, user_create, date_create) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          nomorSJ,
          header.tanggal,
          nomorTerima,
          header.storeKode,
          header.peminta,
          user.id,
        ]
      );
      await connection.query(
        `INSERT INTO retail.ttrm_sj_hdr (tj_nomor, tj_tanggal, user_create, date_create) VALUES (?, ?, ?, NOW())`,
        [nomorTerima, header.tanggal, user.id]
      );
    }

    // INSERT DETAIL BARU
    for (const item of items) {
      if (item.kode && item.jumlah > 0) {
        await connection.query(
          `INSERT INTO tdc_sj_dtl (sjd_nomor, sjd_kode, sjd_ukuran, sjd_jumlah) VALUES (?, ?, ?, ?)`,
          [nomorSJ, item.kode, item.ukuran, item.jumlah]
        );
        await connection.query(
          `INSERT INTO retail.ttrm_sj_dtl (tjd_nomor, tjd_kode, tjd_ukuran, tjd_jumlah) VALUES (?, ?, ?, ?)`,
          [nomorTerima, item.kode, item.ukuran, item.jumlah]
        );
      }
    }

    await connection.commit();
    return {
      message: `Data berhasil disimpan dengan nomor ${nomorSJ}`,
      nomor: nomorSJ,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const lookupProductByBarcode = async (barcode, gudang) => {
  const query = `
        SELECT 
            b.brgd_kode AS kode,
            b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                FROM retail.tmasterstok m 
                WHERE m.mst_aktif = "Y" AND m.mst_cab = ? AND m.mst_brg_kode = b.brgd_kode AND m.mst_ukuran = b.brgd_ukuran
            ), 0) AS stok
        FROM retail.tbarangdc_dtl b
        INNER JOIN retail.tbarangdc a ON a.brg_kode = b.brgd_kode
        WHERE a.brg_aktif = 0 AND b.brgd_barcode = ?;
    `;
  const [rows] = await pool.query(query, [gudang, barcode]);
  if (rows.length === 0) throw new Error("Barcode tidak ditemukan.");
  return rows[0];
};

module.exports = {
  getDataForEdit,
  saveData,
  lookupProductByBarcode,
};
