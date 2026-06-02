const pool = require("../config/database");
const { format } = require("date-fns");

const getSoDates = async (cabang) => {
  let query = "SELECT st_tanggal FROM tsop_tanggal";
  const params = [];

  if (cabang && cabang !== "ALL") {
    query += " WHERE st_cab = ?";
    params.push(cabang);
  }

  query += " ORDER BY st_tanggal DESC";
  const [rows] = await pool.query(query, params);
  return rows;
};

const getList = async (filters) => {
  const { cabang, jenis } = filters;

  let query = `
    SELECT 
      lo.lo_idrec, lo.lo_cab, lo.lo_lokasi, lo.lo_jenis_nama,
      lo.user_create, lo.date_create,
      g.gdg_nama as cab_nama,
      -- [TAMBAH] info invoice gudang
      g.gdg_inv_nama,
      g.gdg_inv_alamat,
      g.gdg_inv_kota,
      g.gdg_inv_telp,
      IFNULL((
        SELECT SUM(h.hs_qty) 
        FROM thitungstok h 
        WHERE h.hs_cab = lo.lo_cab 
          AND h.hs_lokasi = lo.lo_lokasi 
          AND h.hs_proses = 'N'
      ), 0) as total_hitung,
      IFNULL((
        SELECT GROUP_CONCAT(DISTINCT h.hs_operator SEPARATOR ', ')
        FROM thitungstok h
        WHERE h.hs_cab = lo.lo_cab 
          AND h.hs_lokasi = lo.lo_lokasi 
          AND h.hs_proses = 'N'
      ), '-') as operator_hitung
    FROM tlokasi_opname lo
    LEFT JOIN tgudang g ON lo.lo_cab = g.gdg_kode
    WHERE 1=1
  `;

  const params = [];

  // [FIX] Skip filter cabang jika ALL
  if (cabang && cabang !== "ALL") {
    query += ` AND lo.lo_cab = ?`;
    params.push(cabang);
  }

  if (jenis && jenis !== "ALL" && jenis !== "SEMUA JENIS") {
    query += ` AND lo.lo_jenis_nama = ?`;
    params.push(jenis);
  }

  query += ` ORDER BY LENGTH(lo.lo_lokasi) ASC, lo.lo_lokasi ASC`;

  const [rows] = await pool.query(query, params);
  return rows;
};

const getDetailBarang = async (cabang, lokasi) => {
  const query = `
    SELECT 
      CONCAT(h.hs_cab, '-', h.hs_lokasi, '-', h.hs_kode, '-', h.hs_ukuran) AS hs_idrec,
      h.hs_kode,
      IFNULL(b.brgd_barcode, h.hs_barcode) AS barcode,
      IFNULL(
        TRIM(CONCAT(a.brg_jeniskaos, ' ', a.brg_tipe, ' ', a.brg_lengan, ' ', a.brg_jeniskain, ' ', a.brg_warna)), 
        h.hs_nama
      ) AS nama_barang,
      h.hs_ukuran,
      h.hs_qty,
      h.hs_operator,
      h.date_create,
      h.hs_nopl AS no_packing_list,
      h.hs_noprod AS no_packing_produksi,
      -- [BARU] Info gudang
      g.gdg_inv_nama,
      g.gdg_inv_alamat,
      g.gdg_inv_kota,
      g.gdg_inv_telp
    FROM thitungstok h
    LEFT JOIN tbarangdc a ON a.brg_kode = h.hs_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = h.hs_kode AND b.brgd_ukuran = h.hs_ukuran
    LEFT JOIN tgudang g ON g.gdg_kode = h.hs_cab
    WHERE h.hs_cab = ? 
      AND h.hs_lokasi = ? 
      AND h.hs_proses = 'N'
    ORDER BY h.date_create DESC
  `;

  const [rows] = await pool.query(query, [cabang, lokasi]);
  return rows;
};

const getMasterOptions = async () => {
  const [rows] = await pool.query(
    "SELECT ml_jenis as jenis, ml_kode as kode, ml_status as status FROM tmaster_lokasi_opname",
  );
  return rows;
};

const bulkGenerate = async (payload) => {
  const { cabang, locations, user, jenisNama } = payload;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const timestamp = require("date-fns").format(
      new Date(),
      "yyyyMMddHHmmssSSS",
    );

    // Pastikan kolom lo_jenis_nama ada dalam list kolom
    const query = `
      INSERT IGNORE INTO tlokasi_opname (lo_idrec, lo_cab, lo_lokasi, lo_jenis_nama, user_create)
      VALUES ?
    `;

    const values = locations.map((loc, index) => [
      `${cabang}LO${timestamp}${index}`,
      cabang,
      loc.toUpperCase(),
      jenisNama, // Data ini yang akan mengisi kolom lo_jenis_nama
      user,
    ]);

    await connection.query(query, [values]);
    await connection.commit();
    return { message: `${locations.length} lokasi berhasil didaftarkan.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const deleteLocation = async (idrec) => {
  await pool.query("DELETE FROM tlokasi_opname WHERE lo_idrec = ?", [idrec]);
  return { message: "Lokasi berhasil dihapus." };
};

module.exports = {
  getSoDates,
  getList,
  getDetailBarang,
  getMasterOptions,
  bulkGenerate,
  deleteLocation,
};
