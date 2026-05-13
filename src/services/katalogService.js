const pool = require("../config/database");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp"); // Pastikan npm install sharp
const { get } = require("http");

const getGalleryByKode = async (kodeBarang) => {
  const [rows] = await pool.query(
    "SELECT img_url, img_index FROM tbarangdc_images WHERE img_brg_kode = ? ORDER BY img_index ASC",
    [kodeBarang],
  );
  return rows;
};

const processGambarProduk = async (tempFilePath, kodeBarang, index) => {
  const folderPath = path.join(process.cwd(), "public", "images", "katalog");
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

  // Nama file unik per slot: KODE_1.jpg, KODE_2.jpg, dst.
  const safeKode = kodeBarang.replace(/[^a-zA-Z0-9-]/g, "_");
  const finalFileName = `${safeKode}_${index}.jpg`;
  const finalPath = path.join(folderPath, finalFileName);

  try {
    await sharp(tempFilePath)
      .resize(500, 500, {
        fit: "cover",
        background: { r: 255, g: 255, b: 255 },
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toFormat("jpeg")
      .jpeg({ quality: 85 })
      .toFile(finalPath);

    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    const imageUrl = `/images/katalog/${finalFileName}`;

    // 1. Simpan/Update ke tabel galeri
    await pool.query(
      `
      INSERT INTO tbarangdc_images (img_brg_kode, img_url, img_index) 
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE img_url = VALUES(img_url)
    `,
      [kodeBarang, imageUrl, index],
    );

    // 2. [PENTING] Jika index = 1, update juga sebagai foto utama di tabel tbarangdc
    // Agar query getPublicStock lama Mas Rizal tidak patah/kosong
    if (Number(index) === 1) {
      await pool.query(
        "UPDATE tbarangdc SET brg_gambar_url = ? WHERE brg_kode = ?",
        [imageUrl, kodeBarang],
      );
    }

    return imageUrl;
  } catch (error) {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    throw error;
  }
};

const updateUrutanKatalog = async (urutanList) => {
  if (!urutanList || urutanList.length === 0) return;

  const connection = await pool.getConnection();
  try {
    // Bangun query UPDATE tunggal yang sangat panjang
    // UPDATE tbarangdc SET brg_urutan_tampil = CASE brg_kode WHEN 'A' THEN 1 WHEN 'B' THEN 2 END WHERE brg_kode IN ('A', 'B')

    let query = "UPDATE tbarangdc SET brg_urutan_tampil = CASE brg_kode ";
    const values = [];
    const ids = [];

    urutanList.forEach((item) => {
      query += "WHEN ? THEN ? ";
      values.push(item.kode, item.urutan);
      ids.push(item.kode);
    });

    query += "END WHERE brg_kode IN (?)";
    values.push(ids);

    await connection.query(query, values);
  } catch (err) {
    console.error("Gagal bulk update urutan:", err);
    throw new Error("Gagal update database urutan.");
  } finally {
    connection.release();
  }
};

const deleteGambarProduk = async (kodeBarang, index) => {
  const [rows] = await pool.query(
    "SELECT img_url FROM tbarangdc_images WHERE img_brg_kode = ? AND img_index = ?",
    [kodeBarang, index],
  );

  if (rows.length > 0) {
    const imageUrl = rows[0].img_url;
    const filePath = path.join(process.cwd(), "public", imageUrl);

    // Hapus file fisik jika ada
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Hapus dari database
    await pool.query(
      "DELETE FROM tbarangdc_images WHERE img_brg_kode = ? AND img_index = ?",
      [kodeBarang, index],
    );

    // Jika yang dihapus adalah Slot 1, cari gambar lain untuk dijadikan thumbnail
    if (Number(index) === 1) {
      const [nextRows] = await pool.query(
        "SELECT img_url FROM tbarangdc_images WHERE img_brg_kode = ? ORDER BY img_index ASC LIMIT 1",
        [kodeBarang],
      );
      const nextUrl = nextRows.length > 0 ? nextRows[0].img_url : null;
      await pool.query(
        "UPDATE tbarangdc SET brg_gambar_url = ? WHERE brg_kode = ?",
        [nextUrl, kodeBarang],
      );
    }
  }
};

const swapGambarProduk = async (kodeBarang, indexA, indexB) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // 1. Pindahkan A ke tempat penampungan sementara (index 999)
    await connection.query(
      "UPDATE tbarangdc_images SET img_index = 999 WHERE img_brg_kode = ? AND img_index = ?",
      [kodeBarang, indexA],
    );
    // 2. Pindahkan B ke posisi A
    await connection.query(
      "UPDATE tbarangdc_images SET img_index = ? WHERE img_brg_kode = ? AND img_index = ?",
      [indexA, kodeBarang, indexB],
    );
    // 3. Pindahkan A (dari 999) ke posisi B
    await connection.query(
      "UPDATE tbarangdc_images SET img_index = ? WHERE img_brg_kode = ? AND img_index = 999",
      [indexB, kodeBarang],
    );

    // Perbarui thumbnail utama jika gambar slot 1 ikut tergeser
    if (indexA === 1 || indexB === 1) {
      const [nextRows] = await connection.query(
        "SELECT img_url FROM tbarangdc_images WHERE img_brg_kode = ? ORDER BY img_index ASC LIMIT 1",
        [kodeBarang],
      );
      const nextUrl = nextRows.length > 0 ? nextRows[0].img_url : null;
      await connection.query(
        "UPDATE tbarangdc SET brg_gambar_url = ? WHERE brg_kode = ?",
        [nextUrl, kodeBarang],
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  getGalleryByKode,
  processGambarProduk,
  updateUrutanKatalog,
  deleteGambarProduk,
  swapGambarProduk,
};
