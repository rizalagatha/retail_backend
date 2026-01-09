const pool = require("../config/database");
const { addMonths, setDate } = require("date-fns");

// Mengambil daftar utama (Master)
const getList = async (filters) => {
  const { startDate, endDate, kodeBarang } = filters;

  let query = `
        SELECT 
            h.sj_nomor AS nomor,
            h.sj_tanggal AS tanggal,
            h.sj_noterima AS nomorTerima,
            t.tj_tanggal AS tglTerima,
            h.sj_kecab AS store,
            g.gdg_nama AS namaStore,
            h.sj_peminta AS peminta,
            IFNULL((
                SELECT CASE 
                    WHEN pin_acc = "" AND pin_dipakai = "" THEN "WAIT"
                    WHEN pin_acc = "Y" AND pin_dipakai = "" THEN "ACC"
                    WHEN pin_acc = "N" THEN "TOLAK"
                    ELSE ""
                END
                FROM kencanaprint.tspk_pin5 
                WHERE pin_trs = "PENGAMBILAN BARANG" AND pin_nomor = h.sj_nomor 
                ORDER BY pin_urut DESC LIMIT 1
            ), "") AS statusEdit,
            h.user_create AS userCreate,
            h.sj_closing AS closing
        FROM tdc_sj_hdr h
        INNER JOIN tdc_sj_dtl d ON d.sjd_nomor = h.sj_nomor
        LEFT JOIN tgudang g ON g.gdg_kode = h.sj_kecab
        LEFT JOIN ttrm_sj_hdr t ON t.tj_nomor = h.sj_noterima
        WHERE 
            h.sj_peminta <> "" AND h.sj_kecab = "K01" 
            AND h.sj_tanggal BETWEEN ? AND ?
    `;

  const params = [startDate, endDate];

  if (kodeBarang) {
    query += ` AND d.sjd_kode = ?`;
    params.push(kodeBarang);
  }

  query += ` GROUP BY h.sj_nomor ORDER BY h.sj_tanggal, h.sj_nomor`;

  const [rows] = await pool.query(query, params);
  return rows;
};

// Mengambil detail item berdasarkan nomor SJ
const getDetails = async (nomor) => {
  const query = `
        SELECT 
            h.sj_nomor AS nomor,
            d.sjd_kode AS kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d.sjd_ukuran AS ukuran,
            d.sjd_jumlah AS jumlah
        FROM tdc_sj_dtl d
        INNER JOIN tdc_sj_hdr h ON d.sjd_nomor = h.sj_nomor
        LEFT JOIN tbarangdc a ON a.brg_kode = d.sjd_kode
        WHERE h.sj_nomor = ?
        ORDER BY d.sjd_nomor;
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

// Menghapus data Pengambilan Barang
const deleteAmbilBarang = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT sj_closing, sj_noterima, sj_tanggal FROM tdc_sj_hdr WHERE sj_nomor = ?`,
      [nomor]
    );

    if (rows.length === 0) throw new Error("Dokumen tidak ditemukan.");

    const doc = rows[0];
    if (doc.sj_closing === "Y")
      throw new Error("Sudah Closing Stok Opname, tidak bisa dihapus.");

    await connection.query("DELETE FROM tdc_sj_hdr WHERE sj_nomor = ?", [
      nomor,
    ]);

    if (doc.sj_noterima) {
      await connection.query("DELETE FROM ttrm_sj_hdr WHERE tj_nomor = ?", [
        doc.sj_noterima,
      ]);
    }
    await connection.query("DELETE FROM tdc_sj_dtl WHERE sjd_nomor = ?", [
      nomor,
    ]);

    await connection.commit();
    return { message: `Dokumen dengan nomor ${nomor} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const lookupProducts = async (filters) => {
  const page = parseInt(filters.page, 10) || 1;
  const itemsPerPage = parseInt(filters.itemsPerPage, 10) || 10;
  const { term } = filters;

  const offset = (page - 1) * itemsPerPage;
  const searchTerm = term ? `%${term}%` : null;

  let fromClause = `FROM tbarangdc a`;
  let whereClause = `WHERE 1=1`; // Dimulai dengan kondisi true
  let params = [];

  if (term) {
    // Pencarian berdasarkan kode atau nama barang (sesuai query Delphi)
    whereClause += ` AND (a.brg_kode LIKE ? OR TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) LIKE ?)`;
    params.push(searchTerm, searchTerm);
  }

  const countQuery = `SELECT COUNT(*) as total ${fromClause} ${whereClause}`;
  const [countRows] = await pool.query(countQuery, params);
  const total = countRows[0].total;

  const dataQuery = `
        SELECT
            a.brg_kode AS kode,
            '' AS barcode, -- Kolom ini dibutuhkan komponen modal, beri nilai kosong jika tidak ada
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            '' AS ukuran, -- Kolom ini dibutuhkan komponen modal
            a.brg_ktg AS kategori,
            a.brg_kode AS uniqueId
        ${fromClause}
        ${whereClause}
        ORDER BY nama
        LIMIT ? OFFSET ?
    `;
  params.push(itemsPerPage, offset);

  const [items] = await pool.query(dataQuery, params);
  return { items, total };
};

const getExportDetails = async (filters) => {
  const { startDate, endDate, kodeBarang } = filters;
  let query = `
        SELECT 
            h.sj_nomor AS 'Nomor',
            h.sj_tanggal AS 'Tanggal',
            h.sj_noterima AS 'Nomor Terima',
            t.tj_tanggal AS 'Tgl Terima',
            g.gdg_nama AS 'Nama Store',
            h.sj_peminta AS 'Peminta',
            d.sjd_kode AS 'Kode Barang',
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS 'Nama Barang',
            d.sjd_ukuran AS 'Ukuran',
            d.sjd_jumlah AS 'Jumlah'
        FROM tdc_sj_hdr h
        INNER JOIN tdc_sj_dtl d ON d.sjd_nomor = h.sj_nomor
        LEFT JOIN tgudang g ON g.gdg_kode = h.sj_kecab
        LEFT JOIN ttrm_sj_hdr t ON t.tj_nomor = h.sj_noterima
        LEFT JOIN tbarangdc a ON a.brg_kode = d.sjd_kode
        WHERE h.sj_peminta <> "" AND h.sj_kecab = "K01"
            AND DATE(h.sj_tanggal) BETWEEN ? AND ?
    `;
  const params = [startDate, endDate];

  if (kodeBarang) {
    query += ` AND d.sjd_kode = ?`;
    params.push(kodeBarang);
  }

  query += ` ORDER BY h.sj_nomor, d.sjd_kode`;
  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getDetails,
  deleteAmbilBarang,
  lookupProducts,
  getExportDetails,
};
