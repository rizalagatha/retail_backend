const pool = require("../config/database");
const { format } = require("date-fns");
const fs = require("fs");
const path = require("path");

// Pastikan path ini benar
const uploadDir = path.join(__dirname, "../../public/images/cabang/KDC"); // Asumsi semua gambar barang external masuk ke KDC

// Helper: getmaxnomor
const generateNewKode = async (connection, date) => {
  const ayy = format(new Date(date), "yy");
  const [rows] = await pool.query(
    'SELECT IFNULL(MAX(RIGHT(brg_kode, 5)), 0) as max_nomor FROM retail.tbarangdc WHERE (brg_ktg <> "" OR brg_kelompok <> "") AND LEFT(brg_kode, 2) = ?',
    [ayy]
  );
  const nextNum = parseInt(rows[0].max_nomor, 10) + 1;
  return `${ayy}${String(nextNum).padStart(5, "0")}`;
};

// Helper: getbcdid
// Helper: getbcdid - return angka langsung
const getNewBarcodeId = async (date) => {
  try {
    const tahun = format(new Date(date), "yyyy");
    console.log("Getting barcode ID for year:", tahun);

    const [rows] = await pool.query(
      'SELECT IFNULL(MAX(brg_bcdid), 0) as max_id FROM retail.tbarangdc WHERE DATE_FORMAT(date_create, "%Y") = ?',
      [tahun]
    );

    const newId = parseInt(rows[0].max_id, 10) + 1;
    console.log("New barcode ID:", newId);

    return newId; // ← Return NUMBER langsung, bukan object
  } catch (error) {
    console.error("Error in getNewBarcodeId service:", error);
    throw error;
  }
};

// Helper: getbarcode
const generateBarcode = (date, barcodeId, kodeUkuran) => {
  const ayy = format(new Date(date), "yy");
  const bcdIdStr = String(barcodeId).padStart(4, "0");
  return `${ayy}${bcdIdStr}${kodeUkuran}`;
};

// Mengambil data untuk filter dan load awal (dari FormCreate)
const getInitialData = async () => {
  const [ktg] = await pool.query(
    'SELECT DISTINCT(kategori) FROM retail.tukuran WHERE kategori <> "" ORDER BY kategori'
  );
  const [ktgp] = await pool.query(
    'SELECT DISTINCT(brg_ktgp) FROM retail.tbarangdc WHERE brg_ktgp <> "" ORDER BY brg_ktgp'
  );
  const [versi] = await pool.query("SELECT hpprezso FROM retail.tversi");
  return {
    kategoriOptions: ktg.map((k) => k.kategori),
    ktgProdukOptions: ktgp.map((k) => k.brg_ktgp),
    hppPercentage: versi[0].hpprezso,
  };
};

// Mengambil daftar ukuran (dari loadukuran)
const getUkuranOptions = async (kategori) => {
  const [rows] = await pool.query(
    "SELECT kode, ukuran FROM retail.tukuran WHERE kategori = ? ORDER BY kode",
    [kategori]
  );
  return rows.map((r) => ({
    no: String(r.kode).padStart(2, "0"),
    aktif: false,
    ukuran: r.ukuran,
    hpp: 0,
    harga: 0,
    barcode: "",
    old: "N",
  }));
};

// Mengambil data untuk mode Ubah (dari loaddata)
const getDataForEdit = async (kode) => {
  const [headerRows] = await pool.query(
    'SELECT *, brg_warna AS nama, brg_bahan AS bahan FROM retail.tbarangdc WHERE brg_ktg <> "" AND brg_kode = ?',
    [kode]
  );
  if (headerRows.length === 0)
    throw new Error("Kode barang external tidak ditemukan.");
  const header = headerRows[0];

  const [detailRows] = await pool.query(
    "SELECT * FROM retail.tbarangdc_dtl WHERE brgd_kode = ?",
    [kode]
  );

  // Ambil path gambar
  const imagePath = `/images/cabang/KDC/${kode}.jpg`;
  header.imageUrl = fs.existsSync(path.join(uploadDir, `${kode}.jpg`))
    ? imagePath
    : null;

  return { header, details: detailRows };
};

// Menyimpan data (dari simpandata)
const saveData = async (data, file, user) => {
  const { header, items } = data;
  const isEdit = !!header.kode && header.kode !== "<-- Kosong=Baru";
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let brgKode = header.kode;
    let barcodeId = parseInt(header.brg_bcdid || "0", 10);

    if (!isEdit) {
      brgKode = await generateNewKode(connection, header.date_create);
      if (barcodeId === 0 || isNaN(barcodeId)) {
        // getNewBarcodeId sekarang return number langsung
        barcodeId = await getNewBarcodeId(header.date_create);
        console.log("Generated barcodeId in saveData:", barcodeId);
      }
    }

    if (isEdit) {
      await connection.query(
        `UPDATE retail.tbarangdc SET 
                    brg_aktif = ?, brg_ktg = ?, brg_ktgp = ?, brg_warna = ?, brg_bahan = ?, 
                    brg_bcdid = ?, brg_logstok = "Y", user_modified = ?, date_modified = NOW()
                 WHERE brg_kode = ?`,
        [
          header.brg_aktif,
          header.brg_ktg,
          header.brg_ktgp,
          header.nama,
          header.bahan,
          barcodeId,
          user.kode,
          brgKode,
        ]
      );
    } else {
      await connection.query(
        `INSERT INTO retail.tbarangdc 
                    (brg_kode, brg_ktg, brg_ktgp, brg_warna, brg_bahan, brg_aktif, brg_bcdid, brg_logstok, user_create, date_create) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, "Y", ?, ?)`,
        [
          brgKode,
          header.brg_ktg,
          header.brg_ktgp,
          header.nama,
          header.bahan,
          header.brg_aktif,
          barcodeId,
          user.kode,
          header.date_create,
        ]
      );
    }

    // Simpan/Hapus Gambar
    const imagePath = path.join(uploadDir, `${brgKode}.jpg`);
    if (file) {
      fs.renameSync(file.path, imagePath);
    } else if (header.imageUrl === null) {
      // Jika user menghapus gambar
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    }

    // Proses Detail (Ukuran)
    for (const item of items) {
      if (item.aktif) {
        let barcode = item.barcode;
        if (!barcode || item.old === "N") {
          barcode = generateBarcode(header.date_create, barcodeId, item.no);
        }

        await connection.query(
          `INSERT INTO retail.tbarangdc_dtl 
                        (brgd_kode, brgd_barcode, brgd_ukuran, brgd_hpp, brgd_harga) 
                     VALUES (?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE 
                        brgd_hpp = ?, brgd_harga = ?`,
          [
            brgKode,
            barcode,
            item.ukuran,
            item.hpp,
            item.harga,
            item.hpp,
            item.harga,
          ]
        );
      }
    }

    await connection.commit();
    return {
      message: `Barang external ${brgKode} berhasil disimpan.`,
      kode: brgKode,
    };
  } catch (error) {
    await connection.rollback();
    if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  getInitialData,
  getUkuranOptions,
  getDataForEdit,
  saveData,
  getNewBarcodeId,
};
