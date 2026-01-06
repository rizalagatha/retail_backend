// services/biayaKirimFormService.js
const pool = require("../config/database");
const { format } = require("date-fns");

/**
 * Generate nomor BK otomatis: CAB.BKyyMMnnnn
 */
const generateBkNumber = async (cabang, tanggal) => {
  const period = format(new Date(tanggal), "yyMM");
  const prefix = `${cabang}.BK${period}`;
  const [rows] = await pool.query(
    "SELECT IFNULL(MAX(RIGHT(bk_nomor, 4)), 0) AS last FROM tbiayakirim WHERE LEFT(bk_nomor, 10) = ?",
    [prefix]
  );
  return `${prefix}${String(parseInt(rows[0].last) + 1).padStart(4, "0")}`;
};

/**
 * Lookup Invoice untuk Form Biaya Kirim
 */
const lookupInvoice = async (term, user, customerKode = null) => {
  const searchTerm = `%${term || ""}%`;

  // Jika ada customerKode, berarti dipanggil dari modul Setoran (F2)
  // Maka cari data di tabel tbiayakirim yang belum lunas
  if (customerKode) {
    const queryBk = `
      SELECT 
        k.bk_nomor AS Nomor, 
        k.bk_tanggal AS Tanggal, 
        k.bk_nominal AS Nominal,
        IFNULL((SELECT SUM(p.pd_kredit) FROM tpiutang_dtl p WHERE p.pd_ph_nomor = k.bk_nomor), 0) AS Bayar,
        (k.bk_nominal - IFNULL((SELECT SUM(p.pd_kredit) FROM tpiutang_dtl p WHERE p.pd_ph_nomor = k.bk_nomor), 0)) AS Sisa,
        c.cus_nama AS Customer,
        c.cus_alamat AS Alamat
      FROM tbiayakirim k
      LEFT JOIN tinv_hdr h ON h.inv_nomor = k.bk_inv_nomor
      LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
      WHERE h.inv_cus_kode = ? 
        AND k.bk_cab = ? 
        AND (k.bk_nomor LIKE ? OR h.inv_nomor LIKE ?)
      HAVING Sisa > 0
      ORDER BY k.bk_tanggal DESC
    `;
    const [rows] = await pool.query(queryBk, [
      customerKode,
      user.cabang,
      searchTerm,
      searchTerm,
    ]);
    return rows;
  }

  // Logika default (saat input Biaya Kirim baru): Mencari Invoice yang ada
  const queryInv = `
    SELECT h.inv_nomor AS Nomor, h.inv_tanggal AS Tanggal, IFNULL(p.ph_nominal, 0) AS Nominal,
           h.inv_cus_kode AS KdCus, c.cus_nama AS Customer, c.cus_alamat AS Alamat
    FROM tinv_hdr h
    LEFT JOIN tpiutang_hdr p ON p.ph_inv_nomor = h.inv_nomor
    LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
    WHERE h.inv_cab = ? AND (h.inv_nomor LIKE ? OR c.cus_nama LIKE ?)
    ORDER BY h.inv_nomor DESC LIMIT 50
  `;
  const [rows] = await pool.query(queryInv, [
    user.cabang,
    searchTerm,
    searchTerm,
  ]);
  return rows;
};

/**
 * Mengambil data lengkap untuk Edit atau Auto-fill
 */
const getInvoiceDetails = async (nomorInv) => {
  const query = `
    SELECT h.inv_nomor, h.inv_tanggal, IFNULL(p.ph_nominal, 0) AS nominal,
           c.cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp
    FROM tinv_hdr h
    LEFT JOIN tpiutang_hdr p ON p.ph_inv_nomor = h.inv_nomor
    LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
    WHERE h.inv_nomor = ?
  `;
  const [rows] = await pool.query(query, [nomorInv]);
  return rows[0];
};

const saveData = async (payload, user) => {
  const { isNew, header } = payload;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (isNew) {
      header.nomor = await generateBkNumber(user.cabang, header.tanggal);
      const sql = `INSERT INTO tbiayakirim (bk_nomor, bk_tanggal, bk_inv_nomor, bk_nominal, bk_ket, user_create, date_create, bk_cab) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`;
      await connection.query(sql, [
        header.nomor,
        header.tanggal,
        header.inv_nomor,
        header.biaya,
        header.keterangan,
        user.kode,
        user.cabang,
      ]);
    } else {
      const sql = `UPDATE tbiayakirim SET bk_inv_nomor = ?, bk_nominal = ?, bk_ket = ?, user_modified = ?, date_modified = NOW() WHERE bk_nomor = ?`;
      await connection.query(sql, [
        header.inv_nomor,
        header.biaya,
        header.keterangan,
        user.kode,
        header.nomor,
      ]);
    }
    await connection.commit();
    return { nomor: header.nomor };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getPrintData = async (nomor) => {
  const query = `
    SELECT k.*, h.inv_cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp,
           DATE_FORMAT(k.bk_tanggal, '%d %b %Y') as tgl_indo,
           p.pd_tanggal as tgl_bayar, p.pd_uraian as uraian, 
           IFNULL(p.pd_kredit, 0) as nominal_bayar, p.pd_ket as ket_bayar,
           g.gdg_inv_nama, g.gdg_inv_alamat, g.gdg_inv_telp
    FROM tbiayakirim k
    LEFT JOIN tinv_hdr h ON h.inv_nomor = k.bk_inv_nomor
    LEFT JOIN tpiutang_dtl p ON p.pd_ph_nomor = k.bk_inv_nomor AND p.pd_bk = 'Y'
    LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
    LEFT JOIN tgudang g ON g.gdg_kode = k.bk_cab
    WHERE k.bk_nomor = ?
  `;

  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) return null;

  return {
    header: rows[0],
    details: rows.map((r) => ({
      tgl_bayar: r.tgl_bayar,
      uraian: r.uraian,
      nominal: r.nominal_bayar,
      keterangan: r.ket_bayar,
    })),
  };
};

module.exports = { lookupInvoice, getInvoiceDetails, saveData, getPrintData };
