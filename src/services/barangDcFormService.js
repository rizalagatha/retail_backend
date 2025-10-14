const pool = require("../config/database");
const path = require("path");
const fs = require("fs").promises;

const getInitialData = async (user) => {
  try {
    // Jalankan semua query secara bersamaan untuk efisiensi
    const [ukuranRes, jenisKaosRes, tipeRes, lenganRes] = await Promise.all([
      pool.query(
        'SELECT kode, ukuran FROM tukuran WHERE kategori = "" ORDER BY kode'
      ),
      pool.query("SELECT jo_kode, jo_nama FROM tjenisorder ORDER BY jo_nama"),
      pool.query("SELECT Tipe FROM ttipe ORDER BY tipe"),
      pool.query("SELECT Lengan FROM tlengan ORDER BY lengan"),
    ]);

    return {
      ukuran: ukuranRes[0],
      jenisKaos: jenisKaosRes[0].map((j) => `${j.jo_kode} - ${j.jo_nama}`),
      tipe: tipeRes[0].map((t) => t.Tipe),
      lengan: lenganRes[0].map((l) => l.Lengan),
    };
  } catch (error) {
    // Jika terjadi error, log pesan yang lebih detail di konsol backend
    console.error("Error in getInitialData:", error);
    throw new Error(
      "Gagal mengambil data inisial. Periksa nama tabel/kolom di service backend."
    );
  }
};

const getForEdit = async (kode) => {
  // 1. Ambil semua data seperti sebelumnya
  const headerQuery = `
        SELECT 
            a.*, 
            CONCAT(o.jo_kode, " - ", o.jo_nama) AS jenisorder,
            (SELECT kode FROM tjeniskain WHERE JenisKain = a.brg_jeniskain) AS jenisKainKode,
            (SELECT kode FROM twarna WHERE Warna = a.brg_warna) AS warnaKode
        FROM tbarangdc a
        LEFT JOIN tjenisorder o ON o.jo_kode = a.brg_jeniskaos
        WHERE a.brg_kode = ?;
    `;
  const [headerRows] = await pool.query(headerQuery, [kode]);
  if (headerRows.length === 0) throw new Error("Kode barang tidak ditemukan.");
  const header = headerRows[0];

  const [variants] = await pool.query(
    "SELECT * FROM tbarangdc_dtl WHERE brgd_kode = ?",
    [kode]
  );
  const [priceHistory] = await pool.query(
    "SELECT * FROM tharga WHERE kode = ? ORDER BY tanggal DESC",
    [kode]
  );

  const imagePath = path.join(
    process.cwd(),
    "public",
    "images",
    "barang_dc",
    `${kode}.jpg`
  );
  try {
    await fs.access(imagePath);
    // --- BAGIAN PENTING ADA DI SINI ---
    // Buat URL lengkap menggunakan variabel dari .env
    header.gambarUrl = `${process.env.API_BASE_URL}/images/barang_dc/${kode}.jpg`;
  } catch (error) {
    header.gambarUrl = null;
  }

  // 3. Kembalikan semua data
  return { header, variants, priceHistory };
};

const save = async (payload, user) => {
  const { header, variants, isNew } = payload;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let kodeBarang = header.kode;
    if (isNew) {
      // Generate Kode Barang Baru (meniru getmaxnomor)
      const prefix = `${header.jenisKaos.substring(0, 2)}-${
        header.jenisKainKode
      }-${header.warnaKode}`;
      const query =
        'SELECT IFNULL(MAX(RIGHT(brg_kode, 3)), 0) + 1 AS next_num FROM tbarangdc WHERE brg_ktg="" AND LEFT(brg_kode, 12)=?';
      const [rows] = await connection.query(query, [prefix]);
      kodeBarang = `${prefix}-${rows[0].next_num.toString().padStart(3, "0")}`;
      header.kode = kodeBarang;

      // Generate BCD ID baru (meniru getbcdid)
      const year = new Date().getFullYear().toString();
      const [bcdRows] = await connection.query(
        'SELECT IFNULL(MAX(brg_bcdid), 0) + 1 AS next_id FROM tbarangdc WHERE DATE_FORMAT(date_create, "%Y") = ?',
        [year]
      );
      header.bcdId = bcdRows[0].next_id;

      await connection.query(
        `INSERT INTO tbarangdc (brg_kode, brg_jeniskaos, brg_ktgp, brg_tipe, brg_lengan, brg_jeniskain, brg_warna, brg_aktif, brg_bcdid, brg_logstok, user_create, date_create) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          kodeBarang,
          header.jenisKaos.substring(0, 2),
          header.kategoriProduk,
          header.tipe,
          header.lengan,
          header.jenisKain,
          header.warna,
          header.status,
          header.bcdId,
          header.logStok,
          user.kode,
        ]
      );
    } else {
      await connection.query(
        `UPDATE tbarangdc SET brg_aktif = ?, brg_ktgp = ?, brg_logstok = ?, user_modified = ?, date_modified = NOW() WHERE brg_kode = ?`,
        [
          header.status,
          header.kategoriProduk,
          header.logStok,
          user.kode,
          kodeBarang,
        ]
      );
    }

    // Simpan/Update Varian Ukuran
    for (const variant of variants.filter((v) => v.aktif)) {
      let barcode = variant.barcode;
      // Generate barcode baru jika belum ada (meniru getbarcode)
      if (!barcode && header.bcdId) {
        const yearYY = new Date().getFullYear().toString().substring(2);
        const bcdIdPadded = header.bcdId.toString().padStart(4, "0");
        barcode = `${yearYY}${bcdIdPadded}${variant.no}`; // 'no' adalah kode ukuran 2 digit
      }

      await connection.query(
        `INSERT INTO tbarangdc_dtl (brgd_kode, brgd_barcode, brgd_ukuran, brgd_hpp, brgd_harga, brgd_min, brgd_max, brgd_mindc, brgd_maxdc) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE 
                 brgd_barcode = VALUES(brgd_barcode), brgd_hpp = VALUES(brgd_hpp), brgd_harga = VALUES(brgd_harga), 
                 brgd_min = VALUES(brgd_min), brgd_max = VALUES(brgd_max), brgd_mindc = VALUES(brgd_mindc), brgd_maxdc = VALUES(brgd_maxdc)`,
        [
          kodeBarang,
          barcode,
          variant.ukuran,
          variant.hpp,
          variant.harga,
          variant.stokmin,
          variant.stokmax,
          variant.stokmindc,
          variant.stokmaxdc,
        ]
      );
    }

    await connection.commit();
    return {
      message: `Barang DC berhasil disimpan dengan kode: ${kodeBarang}`,
      kode: kodeBarang,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const uploadImage = async (kode, file) => {
  if (!file) throw new Error("Tidak ada file yang diunggah.");

  try {
    // Path yang benar ke folder public/images/cabang
    const uploadPath = path.join(
      process.cwd(),
      "public",
      "images",
      "barang_dc"
    );
    await fs.mkdir(uploadPath, { recursive: true });

    const newFilename = `${kode}.jpg`; // Selalu simpan sebagai .jpg
    const filePath = path.join(uploadPath, newFilename);

    // Langsung pindahkan file dari temp ke folder tujuan
    await fs.rename(file.path, filePath);

    return `/images/barang_dc/${newFilename}`;
  } catch (error) {
    // Cleanup file temp jika error
    if (
      file &&
      (await fs
        .access(file.path)
        .then(() => true)
        .catch(() => false))
    ) {
      await fs.unlink(file.path);
    }
    throw new Error(`Gagal memindahkan gambar: ${error.message}`);
  }
};

const searchWarnaKain = async (filters) => {
  const { term, page, itemsPerPage } = filters;
  const pageNum = parseInt(page, 10) || 1;
  const limit = parseInt(itemsPerPage, 10) || 10;
  const offset = (pageNum - 1) * limit;
  const searchTerm = `%${term || ""}%`;

  const whereClause = `WHERE Warna LIKE ?`;

  // Query untuk menghitung total data
  const countQuery = `SELECT COUNT(*) as total FROM twarna ${whereClause}`;
  const [countRows] = await pool.query(countQuery, [searchTerm]);
  const total = countRows[0].total;

  // Query untuk mengambil data per halaman
  const dataQuery = `
        SELECT Warna AS nama, Kode 
        FROM twarna 
        ${whereClause} 
        ORDER BY Warna
        LIMIT ? OFFSET ?
    `;
  const [items] = await pool.query(dataQuery, [searchTerm, limit, offset]);

  // Kembalikan dalam format objek yang benar
  return { items, total };
};

const getBuffer = async (filters) => {
  const { cabType, warnaType, lenganType, ukuran } = filters;
  let query =
    "SELECT bf_buffer_min, bf_buffer_max FROM tbuffer WHERE bf_cab = ? AND bf_warna = ? AND bf_ukuran = ?";
  let params = [cabType, warnaType, ukuran];

  // Logika dari Delphi: jika warna generik, lengan dikosongkan
  if (warnaType === "WARNA") {
    query += ' AND bf_lengan = ""';
  } else {
    query += " AND bf_lengan = ?";
    params.push(lenganType);
  }

  const [rows] = await pool.query(query, params);
  if (rows.length > 0) {
    return { min: rows[0].bf_buffer_min, max: rows[0].bf_buffer_max };
  }
  // Kembalikan 0 jika tidak ada aturan buffer yang ditemukan
  return { min: 0, max: 0 };
};

module.exports = {
  getInitialData,
  getForEdit,
  save,
  uploadImage,
  searchWarnaKain,
  getBuffer,
};
