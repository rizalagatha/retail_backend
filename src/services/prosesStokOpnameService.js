const pool = require("../config/database");
const { format } = require("date-fns");

/**
 * Mengambil daftar header stok opname yang sudah diproses.
 */
const getList = async (filters) => {
  const { startDate, endDate, cabang } = filters;

  const query = `
    SELECT 
      h.sop_nomor AS nomor,
      h.sop_tanggal AS tanggal,
      h.sop_transfer AS transfer,
      (SELECT SUM(d.sopd_selisih) 
        FROM tsop_dtl2 d 
      WHERE d.sopd_nomor = h.sop_nomor
      ) AS selisih_qty,
      (SELECT SUM(d.sopd_selisih * d.sopd_hpp) FROM tsop_dtl2 d WHERE d.sopd_nomor = h.sop_nomor) AS nominal,
      h.sop_ket AS keterangan 
    FROM tsop_hdr h
    WHERE h.sop_tanggal BETWEEN ? AND ?
      AND sop_cab = ?
    ORDER BY h.sop_nomor
  `;

  const [rows] = await pool.query(query, [startDate, endDate, cabang]);
  return rows;
};

const validateTransferPin = async (code, pin) => {
  const numericCode = parseFloat(code);
  const numericPin = parseFloat(pin);
  if (isNaN(numericCode) || isNaN(numericPin)) {
    throw new Error("Kode atau PIN harus berupa angka.");
  }
  // Contoh formula, bisa disesuaikan
  const expectedPin = numericCode * 15 + 40 * 2;
  if (numericPin !== expectedPin) {
    throw new Error("Otorisasi salah.");
  }
  return { success: true };
};

/**
 * Proses Transfer Stok Opname.
 */
const transferSop = async (nomor, pin, user) => {
  // Di aplikasi web modern, validasi PIN sebaiknya lebih kompleks.
  // Untuk saat ini, kita asumsikan validasi sederhana atau di-bypass.
  // const Z_PIN = 'PIN_RAHASIA_DARI_CONFIG';
  // if (pin !== Z_PIN) throw new Error('PIN Salah.');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Ambil data header untuk validasi
    const [headers] = await connection.query(
      "SELECT sop_nomor, sop_tanggal, sop_transfer, sop_cab as cabang FROM tsop_hdr WHERE sop_nomor = ?",
      [nomor]
    );
    if (headers.length === 0) throw new Error("Dokumen tidak ditemukan.");
    const doc = headers[0];
    if (doc.sop_transfer === "Y")
      throw new Error("Dokumen ini sudah pernah ditransfer.");

    const tanggalSop = format(new Date(doc.sop_tanggal), "yyyy-MM-dd");
    const cabang = doc.cabang;

    // 1. Hapus data lama di tsop_dtl
    await connection.query("DELETE FROM tsop_dtl WHERE sopd_nomor = ?", [
      nomor,
    ]);

    // 2 & 3. Nonaktifkan stok lama di tmasterstok dan tmasterstokso
    const ketSop = format(new Date(tanggalSop), "dd-MM-yyyy");
    await connection.query(
      'UPDATE tmasterstok SET mst_aktif="N", mst_ket = ? WHERE mst_aktif="Y" AND mst_cab = ? AND mst_tanggal < ?',
      [ketSop, cabang, tanggalSop]
    );
    await connection.query(
      'UPDATE tmasterstokso SET mst_aktif="N", mst_ket = ? WHERE mst_aktif="Y" AND mst_cab = ? AND mst_tanggal < ?',
      [ketSop, cabang, tanggalSop]
    );

    // 4. Salin data dari tsop_dtl2 ke tsop_dtl
    await connection.query(
      "INSERT INTO tsop_dtl SELECT * FROM tsop_dtl2 WHERE sopd_nomor = ?",
      [nomor]
    );

    // 5. Update status transfer di tsop_hdr
    await connection.query(
      'UPDATE tsop_hdr SET sop_transfer="Y" WHERE sop_nomor = ?',
      [nomor]
    );

    // 6. Update status proses di thitungstok
    await connection.query(
      'UPDATE thitungstok SET hs_proses="Y" WHERE hs_proses="N" AND hs_cab = ?',
      [cabang]
    );

    // 7. Update tanggal SOP terakhir di tgudang
    await connection.query(
      "UPDATE tgudang SET gdg_lastSopOld = gdg_last_sop, gdg_last_sop = ? WHERE gdg_kode = ?",
      [tanggalSop, cabang]
    );

    // 8. Update status transfer di tsop_tanggal
    await connection.query(
      'UPDATE tsop_tanggal SET st_transfer="Y" WHERE st_cab = ? AND st_tanggal = ?',
      [cabang, tanggalSop]
    );

    await connection.commit();
    return { message: `Transfer Stok Opname untuk nomor ${nomor} berhasil.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getCabangOptions = async (user) => {
  let query;
  const params = [];
  if (user.cabang === "KDC") {
    query =
      "SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang ORDER BY gdg_kode";
  } else {
    query =
      "SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode = ? ORDER BY gdg_kode";
    params.push(user.cabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil detail item stok opname.
 */
const getDetails = async (nomor) => {
  // Query ini adalah terjemahan dari SQLDetail di Delphi
  const query = `
    SELECT 
      d.sopd_kode AS Kode,
      CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna) AS Nama,
      d.sopd_ukuran AS Ukuran,
      d.sopd_Stok AS Stok,
      d.sopd_jumlah AS Jumlah,
      d.sopd_selisih AS Selisih,
      d.sopd_hpp AS Hpp,
      (d.sopd_selisih * d.sopd_hpp) AS Nominal,
      d.sopd_ket AS Lokasi
    FROM tsop_dtl2 d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.sopd_kode
    WHERE d.sopd_nomor = ?
    ORDER BY d.sopd_nomor
  `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

/**
 * Mengambil detail item stok opname untuk keperluan export.
 */
const getExportDetails = async (filters) => {
  const { startDate, endDate, cabang } = filters;

  // Query ini adalah terjemahan dari SQLDetail di Delphi
  const query = `
      SELECT 
        d.sopd_nomor AS 'Nomor SOP',
        h.sop_tanggal AS 'Tanggal',
        d.sopd_kode AS 'Kode Barang',
        CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna) AS 'Nama Barang',
        d.sopd_ukuran AS 'Ukuran',
        d.sopd_stok AS 'Stok Sistem',
        d.sopd_jumlah AS 'Jumlah Fisik',
        d.sopd_selisih AS 'Selisih',
        d.sopd_hpp AS 'HPP',
        (d.sopd_selisih * d.sopd_hpp) AS 'Nominal Selisih',
        d.sopd_ket AS 'Lokasi'
      FROM tsop_dtl2 d
      INNER JOIN tsop_hdr h ON h.sop_nomor = d.sopd_nomor
      LEFT JOIN tbarangdc a ON a.brg_kode = d.sopd_kode
      WHERE h.sop_tanggal BETWEEN ? AND ?
        AND h.sop_cab = ?
      ORDER BY d.sopd_nomor, a.brg_nama, d.sopd_ukuran
    `;
  const [rows] = await pool.query(query, [startDate, endDate, cabang]);
  return rows;
};

module.exports = {
  getList,
  validateTransferPin,
  transferSop,
  getCabangOptions,
  getDetails,
  getExportDetails,
};
