const pool = require("../config/database");

/**
 * Fungsi untuk mengambil nilai buffer dari tabel tbuffer.
 * Direplikasi dari fungsi getbuffer di Delphi.
 */
const getBufferValue = async (cab, bf, warna, lengan, ukuran) => {
  let query;
  const params = [cab, warna, ukuran];

  if (warna === "WARNA") {
    query =
      'SELECT * FROM tbuffer WHERE bf_cab=? AND bf_warna=? AND bf_lengan="" AND bf_ukuran=?';
  } else {
    query =
      "SELECT * FROM tbuffer WHERE bf_cab=? AND bf_warna=? AND bf_lengan=? AND bf_ukuran=?";
    params.splice(2, 0, lengan); // Sisipkan lengan ke parameter
  }

  const [rows] = await pool.query(query, params);
  if (rows.length > 0) {
    return bf === "MIN" ? rows[0].bf_buffer_min : rows[0].bf_buffer_max;
  }
  return 0;
};

/**
 * Service utama untuk mengupdate buffer stok.
 * @param {boolean} updateDc - Apakah akan mengupdate buffer DC.
 * @param {boolean} updateStore - Apakah akan mengupdate buffer Store.
 */
const updateBufferStock = async (updateDc, updateStore) => {
  const connection = await pool.getConnection(); // Gunakan transaksi
  try {
    await connection.beginTransaction();

    // 1. Reset semua buffer ke 0
    const resetQuery = `
        UPDATE tbarangdc_dtl SET 
        brgd_min=0, brgd_max=0, brgd_mindc=0, brgd_maxdc=0
        `;
    await connection.query(resetQuery);

    // 2. Ambil semua barang yang relevan
    const selectProductsQuery = `
        SELECT a.brg_kode, b.brgd_ukuran, a.brg_lengan, a.brg_warna
        FROM tbarangdc a
        INNER JOIN tbarangdc_dtl b ON b.brgd_kode=a.brg_kode AND b.brgd_ukuran IN (SELECT DISTINCT bf_ukuran FROM tbuffer)
        WHERE a.brg_aktif=0 AND a.brg_otomatis=0 AND a.brg_logstok="Y" AND a.brg_ktg="" AND a.brg_ktgp="REGULER"
        AND ((a.brg_lengan LIKE "%PANJANG%") OR (a.brg_lengan LIKE "%PENDEK%"))
        ORDER BY a.brg_kode
    `;
    const [products] = await connection.query(selectProductsQuery);

    // 3. Loop melalui setiap produk dan update buffer-nya
    for (const product of products) {
      let lengan = "";
      if (product.brg_lengan.includes("PENDEK")) lengan = "PENDEK";
      else if (product.brg_lengan.includes("PANJANG")) lengan = "PANJANG";

      let warna = "WARNA";
      if (product.brg_warna === "HITAM") warna = "HITAM";
      else if (["PUTIH", "PUTIH TULANG"].includes(product.brg_warna))
        warna = "PUTIH";

      const minStore = await getBufferValue(
        "STORE",
        "MIN",
        warna,
        lengan,
        product.brgd_ukuran
      );
      const maxStore = await getBufferValue(
        "STORE",
        "MAX",
        warna,
        lengan,
        product.brgd_ukuran
      );
      const minDc = await getBufferValue(
        "DC",
        "MIN",
        warna,
        lengan,
        product.brgd_ukuran
      );
      const maxDc = await getBufferValue(
        "DC",
        "MAX",
        warna,
        lengan,
        product.brgd_ukuran
      );

      let updateQuery = "UPDATE tbarangdc_dtl SET ";
      const updates = [];
      if (updateStore) {
        updates.push(`brgd_min = ${minStore}`, `brgd_max = ${maxStore}`);
      }
      if (updateDc) {
        updates.push(`brgd_mindc = ${minDc}`, `brgd_maxdc = ${maxDc}`);
      }

      if (updates.length > 0) {
        updateQuery += updates.join(", ");
        updateQuery += ` WHERE brgd_kode = ? AND brgd_ukuran = ?`;
        await connection.query(updateQuery, [
          product.brg_kode,
          product.brgd_ukuran,
        ]);
      }
    }

    await connection.commit(); // Jika semua berhasil, commit transaksi
    return { success: true, message: "Update Buffer Stok Selesai." };
  } catch (error) {
    await connection.rollback(); // Jika ada error, batalkan semua perubahan
    console.error("Error during buffer stock update:", error);
    throw new Error("Gagal mengupdate buffer stok.");
  } finally {
    connection.release(); // Selalu lepaskan koneksi
  }
};

// Di file: src/services/bufferStokService.js

const getList = async (filters) => {
  const { cabang, tampilkanBufferNol, kaosan, reszo } = filters;
  let params = [cabang, cabang, cabang];

  let bufferFilter = "";
  if (tampilkanBufferNol === "false") {
    bufferFilter =
      cabang === "KDC" ? "AND b.brgd_mindc <> 0" : "AND b.brgd_min <> 0";
  }

  let brandFilter = "";
  if (kaosan === "true" && reszo === "false") {
    brandFilter = 'AND a.brg_ktg = ""';
  } else if (kaosan === "false" && reszo === "true") {
    brandFilter = 'AND a.brg_ktg <> ""';
  }

  const query = `
    SELECT 
        y.*,
        CASE
            WHEN y.Harus_Minta > 0 THEN 'Harus Minta'
            WHEN y.Sudah_Minta > 0 THEN 'Sudah Minta'
            ELSE 'Cukup'
        END AS Status
    FROM (
        SELECT 
            a.brg_ktgp AS KtgProduk, a.brg_kode AS Kode, 
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS Nama,
            b.brgd_ukuran AS Ukuran, b.brgd_barcode AS Barcode,
            IFNULL(b.brgd_min, 0) AS MinBuffer, IFNULL(b.brgd_max, 0) AS MaxBuffer,
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m
                WHERE m.mst_aktif = "Y" AND m.mst_cab = ? AND m.mst_brg_kode = a.brg_kode AND m.mst_ukuran = b.brgd_ukuran
            ), 0) AS Stok,
            (IF(
                IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif = "Y" AND m.mst_cab = ? AND m.mst_brg_kode = a.brg_kode AND m.mst_ukuran = b.brgd_ukuran), 0) < IFNULL(b.brgd_min, 0) AND IFNULL(b.brgd_min, 0) > 0, 
                IFNULL(b.brgd_max, 0) - IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif = "Y" AND m.mst_cab = ? AND m.mst_brg_kode = a.brg_kode AND m.mst_ukuran = b.brgd_ukuran), 0), 
                0
            )) AS Harus_Minta,
            IFNULL((
                SELECT SUM(d.mtd_jumlah) FROM tmintabarang_dtl d 
                WHERE LEFT(d.mtd_nomor, 3) = ?
                    AND d.mtd_kode = a.brg_kode AND d.mtd_ukuran = b.brgd_ukuran 
                    AND d.mtd_nomor NOT IN (
                        SELECT j.sj_mt_nomor FROM tdc_sj_hdr j 
                        WHERE j.sj_noterima = "" AND j.sj_kecab = ? AND j.sj_mt_nomor <> ""
                    )
            ), 0) AS Sudah_Minta
        FROM tbarangdc a
        JOIN tbarangdc_dtl b ON b.brgd_kode = a.brg_kode
        WHERE a.brg_aktif = 0 AND a.brg_logstok = "Y" AND a.brg_ktgp = "REGULER"
        ${bufferFilter}
        ${brandFilter}
        ) y 
        ORDER BY y.Nama, y.Ukuran
    `;
  params.push(cabang, cabang);

  const [rows] = await pool.query(query, params);
  return rows;
};

const getCabangList = async (user) => {
  let query;
  if (user.cabang === "KDC") {
    // Query untuk KDC tetap sama
    query =
      'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode="KDC" OR gdg_dc=0 ORDER BY gdg_kode';
  } else {
    // Query untuk cabang lain tetap sama
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?";
  }
  const [rows] = await pool.query(query, [user.cabang]);

  // Langsung kembalikan hasilnya tanpa menambahkan "ALL"
  return rows;
};

const saveSetting = async (data, user) => {
  const { kode, ukuran, min, max } = data;
  // Validasi dari Delphi
  if (min > max) {
    throw new Error("Minimal Stok tidak boleh lebih besar dari Maximal Stok.");
  }

  const query = `
    INSERT INTO tbarangdc_dtl2 (brgd_cab, brgd_kode, brgd_ukuran, brgd_min, brgd_max, user_update, date_update) 
    VALUES (?, ?, ?, ?, ?, ?, NOW()) 
    ON DUPLICATE KEY UPDATE 
        brgd_min = VALUES(brgd_min),
        brgd_max = VALUES(brgd_max),
        user_update = VALUES(user_update),
        date_update = VALUES(date_update)
    `;
  await pool.query(query, [user.cabang, kode, ukuran, min, max, user.kode]);

  const stokSaatIni = 0; // TODO: Perlu query untuk ambil stok saat ini jika ingin mengembalikan 'Harus_Minta'
  const harusMinta = stokSaatIni < min && min > 0 ? max - stokSaatIni : 0;

  return {
    message: "Pengaturan buffer berhasil disimpan.",
    updatedData: { MinBuffer: min, MaxBuffer: max, Harus_Minta: harusMinta },
  };
};

module.exports = {
  updateBufferStock,
  getList,
  getCabangList,
  saveSetting,
};
