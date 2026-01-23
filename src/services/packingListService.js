const pool = require("../config/database");

/**
 * Mengambil daftar Packing List.
 */
const getList = async (filters) => {
  const { startDate, endDate, kodeBarang, cabang } = filters;

  let params = [startDate, endDate];
  let itemFilter = "";
  let branchFilter = "";

  // Filter Cabang Tujuan (Store)
  if (cabang && cabang !== "KDC" && cabang !== "ALL") {
    branchFilter = "AND h.pl_cab_tujuan = ?";
    params.push(cabang);
  }

  // Filter Item (Jika user mencari berdasarkan barang tertentu)
  if (kodeBarang) {
    itemFilter = "AND d.pld_kode = ?";
    params.push(kodeBarang);
  }

  const query = `
    SELECT 
        h.pl_nomor AS Nomor,
        h.pl_tanggal AS Tanggal,
        LEFT(h.pl_nomor, 3) AS Cabang_Asal,
        h.pl_cab_tujuan AS Store,
        g.gdg_nama AS Nama_Store,
        h.pl_mt_nomor AS NoMinta,
        m.mt_tanggal AS TglMinta,
        CASE 
            WHEN h.pl_status = 'O' THEN 'OPEN'
            -- Jika Closed tapi belum ada No Terima di SJ, berarti masih dikirim (OTW)
            WHEN h.pl_status = 'C' AND (sj.sj_noterima IS NULL OR sj.sj_noterima = '') THEN 'SENT'
            -- Jika Closed dan sudah ada No Terima, berarti sudah sampai
            WHEN h.pl_status = 'C' AND sj.sj_noterima <> '' THEN 'RECEIVED'
            ELSE h.pl_status 
        END AS Status,
        IFNULL(sj.sj_noterima, '-') AS NoTerima,
        IFNULL(h.pl_sj_nomor, '-') AS NoSJFinal,
        h.pl_ket AS Keterangan,
        h.user_create AS Usr
    FROM tpacking_list_hdr h
    INNER JOIN tpacking_list_dtl d ON d.pld_nomor = h.pl_nomor
    LEFT JOIN tgudang g ON g.gdg_kode = h.pl_cab_tujuan
    LEFT JOIN tdc_sj_hdr sj ON sj.sj_nomor = h.pl_sj_nomor
    LEFT JOIN tmintabarang_hdr m ON m.mt_nomor = h.pl_mt_nomor
    WHERE h.pl_tanggal BETWEEN ? AND ?
      ${branchFilter}
      ${itemFilter}
    GROUP BY h.pl_nomor 
    ORDER BY h.pl_tanggal DESC, h.pl_nomor DESC
  `;

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil detail item untuk accordion/expand.
 */
const getDetails = async (nomor) => {
  const query = `
    SELECT 
        d.pld_kode AS Kode,
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS Nama,
        d.pld_ukuran AS Ukuran,
        d.pld_jumlah AS Jumlah
    FROM tpacking_list_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.pld_kode
    WHERE d.pld_nomor = ?
    ORDER BY d.pld_kode, d.pld_ukuran;
  `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

/**
 * Menghapus Packing List (Hanya jika status masih OPEN/Belum jadi SJ).
 */
const remove = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Cek Status dulu
    const [headers] = await connection.query(
      "SELECT pl_status, pl_sj_nomor FROM tpacking_list_hdr WHERE pl_nomor = ?",
      [nomor],
    );

    if (headers.length === 0) throw new Error("Data tidak ditemukan.");

    if (headers[0].pl_status === "C" || headers[0].pl_sj_nomor) {
      throw new Error(
        `Packing List sudah diproses menjadi SJ Final (${headers[0].pl_sj_nomor}). Tidak bisa dihapus.`,
      );
    }

    await connection.query("DELETE FROM tpacking_list_hdr WHERE pl_nomor = ?", [
      nomor,
    ]);
    await connection.query(
      "DELETE FROM tpacking_list_dtl WHERE pld_nomor = ?",
      [nomor],
    );

    await connection.commit();
    return { message: `Packing List ${nomor} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Export data detail untuk Excel.
 */
const exportDetails = async (filters) => {
  const { startDate, endDate, kodeBarang, cabang } = filters;
  const startDateTime = startDate ? `${startDate} 00:00:00` : null;
  const endDateTime = endDate ? `${endDate} 23:59:59` : null;

  let params = [startDateTime, endDateTime];
  let itemFilter = "";
  let branchFilter = "";

  if (cabang && cabang !== "KDC" && cabang !== "ALL") {
    branchFilter = "AND h.pl_cab_tujuan = ?";
    params.push(cabang);
  }

  if (kodeBarang) {
    itemFilter = "AND d.pld_kode = ?";
    params.push(kodeBarang);
  }

  const query = `
    SELECT 
      h.pl_nomor AS "No. Packing List",
      DATE_FORMAT(h.pl_tanggal, "%Y-%m-%d") AS "Tanggal",
      LEFT(h.pl_nomor, 3) AS "Cabang Asal",
      h.pl_cab_tujuan AS "Kode Store",
      g.gdg_nama AS "Nama Store",
      h.pl_mt_nomor AS "No. Minta Barang",
      IF(h.pl_status='C', 'CLOSE', 'OPEN') AS "Status",
      h.pl_sj_nomor AS "No. SJ Final",
      
      d.pld_kode AS "Kode Barang",
      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS "Nama Barang",
      d.pld_ukuran AS "Ukuran",
      d.pld_jumlah AS "Jumlah"

    FROM tpacking_list_hdr h
    INNER JOIN tpacking_list_dtl d ON d.pld_nomor = h.pl_nomor
    LEFT JOIN tgudang g ON g.gdg_kode = h.pl_cab_tujuan
    LEFT JOIN tbarangdc a ON a.brg_kode = d.pld_kode
    
    WHERE h.pl_tanggal >= ? AND h.pl_tanggal <= ?
      ${branchFilter}
      ${itemFilter}
      
    ORDER BY h.pl_tanggal DESC, h.pl_nomor DESC, d.pld_kode ASC
  `;

  const [rows] = await pool.query(query, params);
  return rows;
};

// Ambil list cabang untuk filter (reuse logic existing SJ)
const getCabangList = async (user) => {
  let query = "";
  const params = [];

  // Izinkan KDC dan KBS untuk melihat daftar semua gudang
  if (user.cabang === "KDC" || user.cabang === "KBS") {
    query = `SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang ORDER BY gdg_kode`;
  } else {
    // Cabang lain hanya bisa melihat cabangnya sendiri
    query = `SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ? ORDER BY gdg_kode`;
    params.push(user.cabang);
  }

  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getDetails,
  remove,
  exportDetails,
  getCabangList,
};
