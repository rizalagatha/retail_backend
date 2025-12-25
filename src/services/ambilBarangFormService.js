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
  const { header, items, approvalInfo, approver } = payload;
  const isEdit = !!header.nomor;
  const connection = await pool.getConnection();

  const userId = user?.kode || user?.id || "SYSTEM";

  try {
    await connection.beginTransaction();

    let nomorSJ = header.nomor;
    let nomorTerima = header.nomorTerima;

    if (isEdit) {
      // UPDATE HEADER
      await connection.query(
        `UPDATE tdc_sj_hdr SET sj_tanggal = ?, sj_peminta = ?, user_modified = ?, date_modified = NOW() WHERE sj_nomor = ?`,
        [header.tanggal, header.peminta, userId, nomorSJ] // Gunakan userId
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
          userId, // <--- INI YANG MEMPERBAIKI ERROR
        ]
      );
      await connection.query(
        `INSERT INTO retail.ttrm_sj_hdr (tj_nomor, tj_tanggal, user_create, date_create) VALUES (?, ?, ?, NOW())`,
        [nomorTerima, header.tanggal, userId]
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

    if (approver) {
      // Opsional: Simpan ke tabel log otorisasi atau update kolom di header jika ada
      // console.log("Transaksi di-approve oleh:", approver);
    }

    // Update Status PIN (Jika pakai sistem lama)
    if (isEdit && approvalInfo && approvalInfo.status === "ACC") {
      await connection.query(
        `UPDATE kencanaprint.tspk_pin5 SET pin_dipakai = 'Y' 
         WHERE pin_trs = 'PENGAMBILAN BARANG' AND pin_nomor = ? AND pin_urut = ?`,
        [header.nomor, approvalInfo.urut]
      );
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

const validateSavePin = async (code, pin) => {
  const numericCode = parseFloat(code);
  const numericPin = parseFloat(pin);

  if (isNaN(numericCode) || isNaN(numericPin)) {
    throw new Error("Kode atau PIN harus berupa angka.");
  }

  // Formula spesifik dari Delphi Tfrmsjk01.btnOkClick
  const expectedPin = numericCode * 11 + 33 * 3;

  if (numericPin !== expectedPin) {
    throw new Error("Otorisasi salah.");
  }

  return { success: true };
};

const getApprovalStatus = async (nomor) => {
  const query = `
        SELECT pin_acc, pin_dipakai, pin_urut 
        FROM kencanaprint.tspk_pin5 
        WHERE pin_trs = "PENGAMBILAN BARANG" AND pin_nomor = ? 
        ORDER BY pin_urut DESC LIMIT 1
    `;
  const [rows] = await pool.query(query, [nomor]);

  if (rows.length === 0) {
    return { status: "MINTA" }; // Belum ada pengajuan
  }

  const lastRequest = rows[0];
  let status = "MINTA"; // Default jika kondisi lain tidak terpenuhi

  if (lastRequest.pin_acc === "" && lastRequest.pin_dipakai === "") {
    status = "WAIT";
  } else if (lastRequest.pin_acc === "Y" && lastRequest.pin_dipakai === "") {
    status = "ACC";
  } else if (lastRequest.pin_acc === "N") {
    status = "TOLAK";
  }

  return {
    status: status,
    urut: lastRequest.pin_urut,
  };
};

module.exports = {
  getDataForEdit,
  saveData,
  lookupProductByBarcode,
  validateSavePin,
  getApprovalStatus,
};
