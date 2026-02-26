const pool = require("../config/database");
const { format } = require("date-fns");

/**
 * Mengambil daftar divisi untuk dropdown header SPK
 */
const getDivisiList = async () => {
  const query = "SELECT kode, nama FROM tdivisi WHERE kode <> 0 ORDER BY kode";
  const [rows] = await pool.query(query);
  return rows;
};

const getSpkLookups = async () => {
  // 1. Ambil Kepentingan (Urgency)
  const [kepentingan] = await pool.query(
    "SELECT kepentingan AS nama FROM tspk_kepentingan ORDER BY kode",
  );

  // 2. Ambil Master Size (XS, S, M, L, dll)
  const [sizes] = await pool.query(
    'SELECT ukuran FROM retail.tukuran WHERE kategori = "" ORDER BY kode',
  );

  // 3. Ambil Master Komponen Produksi
  const [komponen] = await pool.query(
    "SELECT kode, nama FROM tketkomponen ORDER BY kode",
  );

  return { kepentingan, sizes, komponen };
};

/**
 * Mengambil daftar Jenis Order berdasarkan Divisi (Logic Masking Delphi)
 */
const getJenisOrderList = async (divisi, cabang) => {
  let query = "";
  let params = [];

  if (divisi === "3") {
    // Divisi Kaosan
    // Jika bukan KDC, sembunyikan kode tertentu (SD, SB, BR, PL)
    const excludeFilter =
      cabang !== "KDC" && cabang !== ""
        ? 'AND jo_kode NOT IN ("SD", "SB", "BR", "PL")'
        : "";

    query = `SELECT jo_kode AS kode, jo_nama AS nama 
             FROM tjenisorder 
             WHERE jo_divisi IN (3, 4, 6) ${excludeFilter} 
             ORDER BY jo_nama`;
  } else if (divisi === "4" || divisi === "6") {
    // Garmen
    query =
      "SELECT jo_kode AS kode, jo_nama AS nama FROM tjenisorder WHERE jo_divisi = 4 ORDER BY jo_nama";
  } else {
    query =
      "SELECT jo_kode AS kode, jo_nama AS nama FROM tjenisorder WHERE jo_divisi = ? ORDER BY jo_nama";
    params = [divisi];
  }

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Pembuatan Nomor SPK Otomatis (Masking MANKSI)
 * Format: SM-KO-000001
 */
const generateSpkNumber = async (connection) => {
  const prefix = "SM-KO-"; // Default Perusahaan SM & Jenis Kaosan (KO)
  const query = `
    SELECT IFNULL(MAX(CAST(RIGHT(spk_nomor, 6) AS UNSIGNED)), 0) + 1 AS next_num 
    FROM tspk 
    WHERE spk_nomor LIKE '${prefix}%'
  `;
  const [rows] = await connection.query(query);
  const nextNum = rows[0].next_num.toString().padStart(6, "0");
  return `${prefix}${nextNum}`;
};

const createSpkFromSo = async (payload, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const { header, sizeQty, ketProduksi, komponen } = payload;
    const newSpkNomor = await generateSpkNumber(connection);

    // 1. Insert Header SPK (Hanya field yang diperlukan Kaosan)
    const headerQuery = `
      INSERT INTO tspk (
        spk_nomor, spk_tanggal, spk_divisi, spk_perush_kode, 
        spk_cus_kode, spk_nama, spk_workshop, spk_dateline,
        spk_sal_kode, spk_nomor_po, spk_ket, spk_desain,
        user_create, date_create, spk_aktif
      ) VALUES (?, ?, 3, 'SM', ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'Y')
    `;

    await connection.query(headerQuery, [
      newSpkNomor,
      header.tanggal,
      header.customerKode,
      header.projectNama, // Nama desain/project
      header.workshopKode,
      header.datelineCustomer,
      user.kode, // Sales dari login atau payload
      header.refSo, // Nomor SO sebagai referensi
      ketProduksi,
      header.bagianDesain,
      user.kode,
    ]);

    // 2. Insert Detail Size (XS s/d 5XL)
    const sizeEntries = Object.entries(sizeQty).filter(([_, qty]) => qty > 0);
    if (sizeEntries.length > 0) {
      const sizeValues = sizeEntries.map(([size, qty]) => [
        newSpkNomor,
        size,
        qty,
      ]);
      await connection.query(
        "INSERT INTO tspk_size (spks_nomor, spks_size, spks_qty) VALUES ?",
        [sizeValues],
      );
    }

    // 3. Insert Keterangan Komponen (Hanya yang dicentang)
    if (komponen && komponen.length > 0) {
      const komponenValues = komponen.map((k) => [newSpkNomor, k.kode, k.ket]);
      await connection.query(
        "INSERT INTO tspk_ketkomponen (skk_spk, skk_kode, skk_ket) VALUES ?",
        [komponenValues],
      );
    }

    // 4. Update Referensi di SO Asal
    await connection.query(
      "UPDATE tso_hdr SET so_spk_nomor = ? WHERE so_nomor = ?",
      [newSpkNomor, header.refSo],
    );

    await connection.commit();
    return { nomor: newSpkNomor, message: "SPK Produksi berhasil digenerate." };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  getDivisiList,
  getJenisOrderList,
  getSpkLookups,
  createSpkFromSo,
};
