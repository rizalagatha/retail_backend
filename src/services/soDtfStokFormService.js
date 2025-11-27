const pool = require("../config/database");
const fs = require("fs");
const path = require("path");
const { format } = require("date-fns");

// Fungsi untuk mengambil template grid (dari edtjoExit)
const getTemplateItems = async (jenisOrder) => {
  const brg_kode = jenisOrder === "SD" ? "2500053" : "2500060"; // SD=DTF, DP=DTF Premium
  const query = `
    SELECT 
      b.brgd_kode AS kode,
      a.brg_warna AS nama,
      b.brgd_ukuran AS ukuran,
      c.us_panjang AS panjang,
      c.us_lebar AS lebar
    FROM retail.tbarangdc_dtl b
    JOIN retail.tbarangdc a ON a.brg_kode = b.brgd_kode
    LEFT JOIN tukuran_sodtf c ON c.us_ukuran = b.brgd_ukuran AND c.us_jenis = ?
    WHERE a.brg_aktif = 0 AND a.brg_logstok = "Y" AND a.brg_kode = ?
  `;
  const [rows] = await pool.query(query, [jenisOrder, brg_kode]);
  // Tambahkan field jumlah = 0
  return rows.map((row) => ({ ...row, jumlah: 0 }));
};

// Fungsi untuk memuat data saat mode Ubah (dari loaddataall)
const loadDataForEdit = async (nomor) => {
  const [headerRows] = await pool.query(
    "SELECT h.*, s.sal_nama, j.jo_nama, g.pab_nama FROM tsodtf_hdr h LEFT JOIN kencanaprint.tsales s ON s.sal_kode=h.sd_sal_kode LEFT JOIN kencanaprint.tjenisorder j ON j.jo_kode=h.sd_jo_kode LEFT JOIN kencanaprint.tpabrik g ON g.pab_kode=h.sd_workshop WHERE h.sd_nomor = ?",
    [nomor]
  );

  if (headerRows.length === 0) throw new Error("Data tidak ditemukan.");

  const [detailRows] = await pool.query(
    "SELECT * FROM tsodtf_stok WHERE sds_nomor = ? ORDER BY sds_nourut",
    [nomor]
  );

  // Cari gambar dengan berbagai ekstensi
  const imageUrl = findImageFile(nomor);

  return {
    header: { ...headerRows[0], imageUrl },
    details: detailRows,
  };
};

const generateNewSoNumber = async (connection, data, user) => {
  const tanggal = new Date(data.header.tanggal);
  const branch = user.cabang;
  const jenis = data.header.jenisOrderKode;
  const datePrefix = format(tanggal, "yyMM");

  // EXACT seperti Delphi
  const prefix11 = `${branch}.${jenis}.${datePrefix}`;

  const query = `
    SELECT IFNULL(MAX(CAST(RIGHT(sd_nomor, 4) AS UNSIGNED)), 0) AS maxNum
    FROM tsodtf_hdr
    WHERE LEFT(sd_nomor, 11) = ?
    FOR UPDATE
  `;

  const [rows] = await connection.query(query, [prefix11]);

  const next = parseInt(rows[0].maxNum || 0) + 1;
  const seq = String(next).padStart(4, "0");

  // hasil final
  return `${prefix11}.${seq}`;
};

// Fungsi untuk menyimpan data (dari simpandata)
const saveData = async (nomor, data, user) => {
  const { header, details } = data;
  const isEdit = !!nomor;
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    let currentNomor = nomor;

    // NOMOR HANYA DIGENERATE KALAU INSERT BARU
    if (!isEdit) {
      currentNomor = await generateNewSoNumber(connection, data, user);
    }

    if (isEdit) {
      // UPDATE HEADER
      const updateQuery = `
        UPDATE tsodtf_hdr 
        SET sd_datekerja = ?, sd_sal_kode = ?, sd_jo_kode = ?, sd_nama = ?, 
            sd_desain = ?, sd_workshop = ?, sd_ket = ?, 
            user_modified = ?, date_modified = NOW()
        WHERE sd_nomor = ?
      `;
      await connection.query(updateQuery, [
        header.tglPengerjaan,
        header.salesKode,
        header.jenisOrderKode,
        header.namaDtf,
        header.desain,
        header.workshopKode,
        header.keterangan,
        user.kode,
        currentNomor,
      ]);
    } else {
      // INSERT HEADER
      const insertQuery = `
        INSERT INTO tsodtf_hdr 
        (sd_nomor, sd_tanggal, sd_datekerja, sd_sal_kode, sd_jo_kode, 
         sd_nama, sd_desain, sd_workshop, sd_ket, sd_stok,
         sd_cab,
         user_create, date_create)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, "Y", ?, ?, NOW())
      `;
      await connection.query(insertQuery, [
        currentNomor,
        header.tanggal,
        header.tglPengerjaan,
        header.salesKode,
        header.jenisOrderKode,
        header.namaDtf,
        header.desain,
        header.workshopKode,
        header.keterangan,
        user.cabang,
        user.kode,
      ]);
    }

    // DELETE-THEN-INSERT DETAIL
    await connection.query("DELETE FROM tsodtf_stok WHERE sds_nomor = ?", [
      currentNomor,
    ]);

    for (const [index, item] of details.entries()) {
      const detailQuery = `
        INSERT INTO tsodtf_stok 
        (sds_nomor, sds_kode, sds_ukuran, sds_panjang, sds_lebar, 
         sds_jumlah, sds_nourut)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      await connection.query(detailQuery, [
        currentNomor,
        item.kode,
        item.ukuran,
        item.panjang || 0,
        item.lebar || 0,
        item.jumlah || 0,
        index + 1,
      ]);
    }

    await connection.commit();
    return { message: "Data berhasil disimpan.", nomor: currentNomor };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const searchJenisOrderStok = async (term) => {
  // Query ini meniru logika dari edtjoKeyDown di Delphi
  const query = `
    SELECT 
      jo_kode AS kode, 
      jo_nama AS nama 
    FROM kencanaprint.tjenisorder
    WHERE jo_kode IN ('SD', 'DP') 
      AND (jo_kode LIKE ? OR jo_nama LIKE ?)
    ORDER BY jo_nama
  `;
  const searchTerm = `%${term || ""}%`;
  const [rows] = await pool.query(query, [searchTerm, searchTerm]);
  return rows;
};

/**
 * @description Memproses gambar SO DTF Stok: me-rename dan memindahkan ke folder cabang.
 * @param {string} tempFilePath - Path file sementara dari multer.
 * @param {string} nomorSo - Nomor SO DTF Stok final.
 * @returns {Promise<string>} Path final dari file yang sudah diproses.
 */
const processSoDtfStokImage = async (tempFilePath, nomorSo) => {
  return new Promise((resolve, reject) => {
    const cabang = nomorSo.substring(0, 3);
    const finalFileName = `${nomorSo}${path.extname(tempFilePath)}`;

    // Buat path ke folder tujuan (misal: .../public/images/K01)
    const branchFolderPath = path.join(
      process.cwd(),
      "public",
      "images",
      cabang
    );

    fs.mkdirSync(branchFolderPath, { recursive: true });

    const finalPath = path.join(branchFolderPath, finalFileName);

    // Hapus file lama jika ada (untuk mode edit)
    if (fs.existsSync(finalPath)) {
      fs.unlinkSync(finalPath);
    }

    fs.rename(tempFilePath, finalPath, (err) => {
      if (err) {
        console.error("Gagal me-rename file SO DTF Stok:", err);
        return reject(new Error("Gagal memproses file gambar SO DTF Stok."));
      }
      resolve(finalPath);
    });
  });
};

/**
 * @description Mengambil semua data yang diperlukan untuk mencetak SO DTF Stok.
 * @param {string} nomor - Nomor SO DTF Stok.
 * @returns {Promise<object|null>} Objek berisi semua data untuk dicetak.
 */
const getDataForPrint = async (nomor) => {
  const query = `
    SELECT 
      h.*,
      h.sd_cab AS store,
      g.pab_nama AS gdg_nama,
      o.jo_nama,
      DATE_FORMAT(h.date_create, "%d-%m-%Y %T") AS created,
      IFNULL((SELECT SUM(i.sds_jumlah) FROM tsodtf_stok i WHERE i.sds_nomor = h.sd_nomor), 0) AS jumlah,
      (SELECT CAST(GROUP_CONCAT(CONCAT(sds_ukuran, "=", sds_jumlah) SEPARATOR ", ") AS CHAR) 
    FROM tsodtf_stok WHERE sds_nomor = h.sd_nomor AND sds_jumlah <> 0) AS ukuran
    FROM tsodtf_hdr h
    LEFT JOIN kencanaprint.tpabrik g ON g.pab_kode = h.sd_workshop
    LEFT JOIN kencanaprint.tjenisorder o ON h.sd_jo_kode = o.jo_kode
    WHERE h.sd_nomor = ?
  `;
  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) return null;

  const data = rows[0];

  // Gunakan helper function untuk cari gambar
  data.imageUrl = findImageFile(nomor);

  return data;
};

const findImageFile = (nomor) => {
  const cabang = nomor.substring(0, 3);
  const directoryPath = path.join(process.cwd(), "public", "images", cabang);

  if (!fs.existsSync(directoryPath)) {
    return null;
  }

  const files = fs.readdirSync(directoryPath);

  // Cari file yang namanya dimulai dengan nomor SO + titik
  const fileName = files.find((file) => file.startsWith(nomor + "."));

  if (fileName) {
    return `/images/${cabang}/${fileName}`;
  }

  return null;
};

module.exports = {
  getTemplateItems,
  loadDataForEdit,
  saveData,
  searchJenisOrderStok,
  processSoDtfStokImage,
  getDataForPrint,
  findImageFile,
};
