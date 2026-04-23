const pool = require("../config/database");

// --- 1. Ambil List Cabang (Asal) ---
const getCabangList = async (user) => {
  let query = "";
  const params = [];

  // [PERBAIKAN] Beri akses W01 untuk menarik daftar semua cabang
  if (user.cabang === "KDC" || user.cabang === "W01") {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc = 0 ORDER BY gdg_kode";
  } else {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ? ORDER BY gdg_kode";
    params.push(user.cabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

// --- 2. Ambil List Workshop Tujuan ---
const getWorkshopList = async () => {
  const query =
    "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc = 4 ORDER BY gdg_kode";
  const [rows] = await pool.query(query);
  return rows;
};

// --- 3. Ambil Daftar Mutasi (Tabel Baru) ---
const getList = async (filters) => {
  const { startDate, endDate, cabang, itemCode } = filters;

  // [PERBAIKAN] Jika cabang = ALL, tidak usah di-filter gudang asal-nya
  const cabangFilter = cabang === "ALL" ? "" : "AND f.gdg_kode = ?";
  const params =
    cabang === "ALL"
      ? [startDate, endDate, itemCode || null, itemCode]
      : [startDate, endDate, cabang, itemCode || null, itemCode];

  const query = `
    SELECT
        h.mw_nomor AS nomor,
        h.mw_tanggal AS tanggal,
        h.mw_noterima AS nomorTerima,
        t.mst_tanggal AS tglTerima,
        h.mw_cab_tujuan AS storeTujuan,
        g.gdg_nama AS namaStoreTujuan,
        h.mw_ket AS keterangan,
        h.user_create AS usr,
        h.mw_closing AS 'closing'
    FROM tmutasi_workshop_hdr h
    INNER JOIN tmutasi_workshop_dtl d ON d.mwd_nomor = h.mw_nomor
    LEFT JOIN tgudang f ON f.gdg_kode = h.mw_cab_asal
    LEFT JOIN tgudang g ON g.gdg_kode = h.mw_cab_tujuan
    LEFT JOIN tmst_hdr t ON t.mst_nomor = h.mw_noterima
    WHERE
        h.mw_tanggal BETWEEN ? AND ?
        ${cabangFilter}
        AND (? IS NULL OR d.mwd_kode = ?)
    GROUP BY h.mw_nomor
    ORDER BY h.mw_tanggal DESC, h.mw_nomor DESC;
    `;

  const [rows] = await pool.query(query, params);
  return rows;
};

// --- 4. Ambil Detail Item Mutasi ---
const getDetails = async (nomor) => {
  const query = `
    SELECT
        d.mwd_kode AS kode,
        TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), ' ', IFNULL(a.brg_tipe,''), ' ', IFNULL(a.brg_lengan,''), ' ', IFNULL(a.brg_jeniskain,''), ' ', IFNULL(a.brg_warna,''))) AS nama,
        d.mwd_ukuran AS ukuran,
        d.mwd_jumlah AS jumlah
    FROM tmutasi_workshop_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.mwd_kode
    WHERE d.mwd_nomor = ?
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

// --- 5. Hapus Mutasi Workshop ---
const remove = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      "SELECT mw_noterima, mw_closing FROM tmutasi_workshop_hdr WHERE mw_nomor = ?",
      [nomor],
    );

    if (rows.length === 0) throw new Error("Data tidak ditemukan.");
    const doc = rows[0];

    if (doc.mw_noterima)
      throw new Error("Sudah ada penerimaan. Tidak bisa dihapus.");
    if (doc.mw_closing === "Y")
      throw new Error("Sudah Close Transaksi. Tidak bisa dihapus.");
    if (nomor.substring(0, 3) !== user.cabang && user.cabang !== "KDC") {
      throw new Error(
        `Anda tidak berhak menghapus data milik store ${nomor.substring(0, 3)}.`,
      );
    }

    await connection.query(
      "DELETE FROM tmutasi_workshop_dtl WHERE mwd_nomor = ?",
      [nomor],
    );
    await connection.query(
      "DELETE FROM tmutasi_workshop_hdr WHERE mw_nomor = ?",
      [nomor],
    );

    await connection.commit();
    return { message: `Dokumen ${nomor} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// --- 6. Export Excel ---
const getExportDetails = async (filters) => {
  const { startDate, endDate, cabang, itemCode } = filters;

  // [PERBAIKAN] Jika cabang = ALL, tidak usah di-filter gudang asal-nya
  const cabangFilter = cabang === "ALL" ? "" : "AND f.gdg_kode = ?";
  const params =
    cabang === "ALL"
      ? [startDate, endDate, itemCode || null, itemCode]
      : [startDate, endDate, cabang, itemCode || null, itemCode];

  const query = `
    SELECT 
        h.mw_nomor AS 'Nomor Mutasi',
        DATE_FORMAT(h.mw_tanggal, '%Y-%m-%d') AS 'Tanggal',
        f.gdg_nama AS 'Dari Cabang',
        g.gdg_nama AS 'Ke Workshop',
        h.mw_ket AS 'Keterangan',
        d.mwd_kode AS 'Kode Barang',
        TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), ' ', IFNULL(a.brg_tipe,''), ' ', IFNULL(a.brg_lengan,''), ' ', IFNULL(a.brg_jeniskain,''), ' ', IFNULL(a.brg_warna,''))) AS 'Nama Barang',
        d.mwd_ukuran AS 'Ukuran',
        d.mwd_jumlah AS 'Jumlah'
    FROM tmutasi_workshop_hdr h
    INNER JOIN tmutasi_workshop_dtl d ON d.mwd_nomor = h.mw_nomor
    LEFT JOIN tgudang f ON f.gdg_kode = h.mw_cab_asal
    LEFT JOIN tgudang g ON g.gdg_kode = h.mw_cab_tujuan
    LEFT JOIN tbarangdc a ON a.brg_kode = d.mwd_kode
    WHERE
        DATE(h.mw_tanggal) BETWEEN ? AND ?
        ${cabangFilter}
        AND (? IS NULL OR d.mwd_kode = ?)
    ORDER BY h.mw_tanggal, h.mw_nomor, d.mwd_kode;
    `;

  const [rows] = await pool.query(query, params);
  return rows;
};

// Fungsi searchProducts tetap sama karena dia narik data dari tbarangdc dan tmasterstok
const searchProducts = async (filters) => {
  const { term, gudang, page, itemsPerPage } = filters;
  const offset = (page - 1) * itemsPerPage;
  const searchTerm = term ? `%${term}%` : null;

  let fromClause = `
    FROM tbarangdc a
    LEFT JOIN tbarangdc_dtl b ON CAST(a.brg_kode AS CHAR) = CAST(b.brgd_kode AS CHAR)
    LEFT JOIN (
        SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in - mst_stok_out) AS stok
        FROM tmasterstok
        WHERE mst_aktif = 'Y' AND mst_cab = ? 
        GROUP BY mst_brg_kode, mst_ukuran
    ) s ON s.mst_brg_kode = b.brgd_kode AND s.mst_ukuran = b.brgd_ukuran
    `;
  let whereClause = "WHERE a.brg_aktif=0 AND b.brgd_kode IS NOT NULL";
  let params = [gudang];

  if (gudang === "KBD") {
    whereClause += ' AND a.brg_ktg <> ""';
  }

  if (term) {
    whereClause += ` AND (
        a.brg_kode LIKE ? OR
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) LIKE ? OR
        b.brgd_barcode LIKE ?
        )`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  const countQuery = `SELECT COUNT(*) as total ${fromClause} ${whereClause}`;
  const [countRows] = await pool.query(countQuery, params);
  const total = countRows[0].total;

  const dataQuery = `
    SELECT
        a.brg_kode AS kode, b.brgd_barcode AS barcode,
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
        b.brgd_ukuran AS ukuran, b.brgd_harga AS harga,
        IFNULL(s.stok, 0) AS stok 
    ${fromClause}
    ${whereClause}
    ORDER BY nama, b.brgd_ukuran
    LIMIT ? OFFSET ?
    `;

  params.push(itemsPerPage, offset);
  const [items] = await pool.query(dataQuery, params);

  return { items, total };
};

module.exports = {
  getCabangList,
  getWorkshopList,
  getList,
  getDetails,
  remove,
  getExportDetails,
  searchProducts,
};
