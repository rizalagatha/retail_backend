const pool = require("../config/database");
const { format, addDays } = require("date-fns");

const getList = async (filters, user) => {
  const { startDate, endDate, cabang } = filters;

  // Bagian utama query
  let query = `
        SELECT 
            h.Inv_nomor AS nomor,
            h.Inv_tanggal AS tanggal,
            h.inv_nomor_so AS nomorSo,
            h.inv_top AS top,
            DATE_FORMAT(DATE_ADD(h.Inv_tanggal, INTERVAL h.inv_top DAY), '%d/%m/%Y') AS tempo,
            h.inv_ppn AS ppn,
            h.inv_disc AS diskon,
            h.inv_dp AS dp,
            h.inv_bkrm AS biayaKirim,
            (SELECT ROUND(SUM(dd.invd_jumlah * dd.invd_harga) - hh.inv_disc + (hh.inv_ppn/100 * (SUM(dd.invd_jumlah * dd.invd_harga) - hh.inv_disc))) 
             FROM tinv_dtl dd LEFT JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor WHERE hh.inv_nomor = h.inv_nomor) AS nominal,
            h.Inv_cus_kode AS kdCus,
            c.Cus_Nama AS customer,
            c.Cus_Alamat AS alamat,
            c.Cus_Kota AS kota,
            CONCAT(h.inv_cus_level, " - ", l.level_nama) AS 'level',
            h.Inv_ket AS keterangan,
            h.inv_closing AS closing
        FROM tinv_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.Inv_cus_kode
        LEFT JOIN tcustomer_level l ON l.level_kode = h.inv_cus_level
        WHERE h.inv_sts_pro = 2 AND h.Inv_tanggal BETWEEN ? AND ?
    `;
  const params = [startDate, endDate];

  // Logika filter cabang dari Delphi
  if (user.cabang === "KDC" && cabang === "KDC") {
    query +=
      " AND LEFT(h.inv_nomor, 3) IN (SELECT gdg_kode FROM tgudang WHERE gdg_dc=1)";
  } else {
    query += " AND LEFT(h.inv_nomor, 3) = ?";
    params.push(cabang);
  }
  query += " ORDER BY h.Inv_nomor";

  const [rows] = await pool.query(query, params);
  return rows;
};

const getDetails = async (nomor) => {
  const query = `
        SELECT 
            d.invd_kode AS kode,
            IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), f.sd_nama) AS nama,
            d.invd_Ukuran AS ukuran,
            d.invd_jumlah AS jumlah,
            d.invd_harga AS harga,
            d.invd_disc AS 'diskonPersen',
            d.invd_diskon AS 'diskonRp',
            (d.invd_jumlah * d.invd_harga) AS total
        FROM tinv_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.invd_kode
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.invd_kode
        WHERE d.invd_inv_nomor = ?
        ORDER BY d.invd_nourut;
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

const deleteProforma = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Ambil data untuk validasi
    const [rows] = await connection.query(
      "SELECT inv_closing, LEFT(inv_nomor, 3) as cabang_doc FROM tinv_hdr WHERE inv_nomor = ?",
      [nomor]
    );
    if (rows.length === 0) throw new Error("Dokumen tidak ditemukan.");

    const doc = rows[0];

    // Validasi dari Delphi
    if (doc.inv_closing === "Y")
      throw new Error("Sudah Closing, tidak bisa dihapus.");
    if (user.cabang !== "KDC" && user.cabang !== doc.cabang_doc)
      throw new Error(
        `Anda tidak berhak menghapus data milik store ${doc.cabang_doc}`
      );

    // Lakukan penghapusan
    await connection.query("DELETE FROM tinv_hdr WHERE inv_nomor = ?", [nomor]);
    // Sebaiknya detail juga dihapus, asumsi ada foreign key ON DELETE CASCADE. Jika tidak, tambahkan:
    // await connection.query('DELETE FROM tinv_dtl WHERE invd_inv_nomor = ?', [nomor]);

    await connection.commit();
    return { message: `Proforma Invoice ${nomor} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getExportDetails = async (filters, user) => {
  const { startDate, endDate, cabang } = filters;
  let query = `
        SELECT 
            h.Inv_nomor AS 'Nomor Proforma',
            h.Inv_tanggal AS 'Tanggal',
            h.inv_nomor_so AS 'Nomor SO',
            c.Cus_Nama AS 'Customer',
            d.invd_kode AS 'Kode Barang',
            IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), f.sd_nama) AS 'Nama Barang',
            d.invd_Ukuran AS 'Ukuran',
            d.invd_jumlah AS 'Jumlah',
            d.invd_harga AS 'Harga',
            (d.invd_jumlah * d.invd_harga) AS 'Total'
        FROM tinv_hdr h
        JOIN tinv_dtl d ON h.inv_nomor = d.invd_inv_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = h.Inv_cus_kode
        LEFT JOIN tbarangdc a ON a.brg_kode = d.invd_kode
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.invd_kode
        WHERE h.inv_sts_pro = 2 AND h.Inv_tanggal BETWEEN ? AND ?
    `;
  const params = [startDate, endDate];

  if (user.cabang === "KDC" && cabang === "KDC") {
    query +=
      " AND LEFT(h.inv_nomor, 3) IN (SELECT gdg_kode FROM tgudang WHERE gdg_dc=1)";
  } else {
    query += " AND LEFT(h.inv_nomor, 3) = ?";
    params.push(cabang);
  }
  query += " ORDER BY h.Inv_nomor, d.invd_nourut";

  const [rows] = await pool.query(query, params);
  return rows;
};

const getBranchOptions = async (user) => {
  let query;
  const params = [];

  // --- PERUBAHAN DI SINI: SELECT kode dan nama ---
  if (user.cabang === "KDC") {
    query =
      'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode NOT IN ("KBS", "KPS") ORDER BY gdg_kode';
  } else {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ? ORDER BY gdg_kode";
    params.push(user.cabang);
  }
  const [rows] = await pool.query(query, params);

  // --- PERUBAHAN DI SINI: Kembalikan array of objects ---
  return rows;
};

module.exports = {
  getList,
  getDetails,
  deleteProforma,
  getExportDetails,
  getBranchOptions,
};
