const pool = require("../config/database");
const { format } = require("date-fns");
const fs = require("fs");
const path = require("path");

const findById = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    const headerQuery = `
            SELECT 
                sd_nomor as nomor, sd_tanggal as tanggal, sd_datekerja as tglPengerjaan,
                sd_dateline as datelineCustomer, sd_sal_kode as salesKode, sal_nama as salesNama,
                sd_cus_kode as customerKode, sd_customer as customerNama, cus_alamat as customerAlamat,
                (SELECT IFNULL(CONCAT(y.clh_level, ' - ', v.level_nama), '') 
                 FROM tcustomer_level_history y 
                 LEFT JOIN tcustomer_level v ON v.level_kode=y.clh_level 
                 WHERE y.clh_cus_kode=h.sd_cus_kode 
                 ORDER BY y.clh_tanggal DESC, y.clh_level DESC 
                 LIMIT 1) as customerLevel,
                sd_jo_kode as jenisOrderKode, jo_nama as jenisOrderNama, sd_nama as namaDtf, sd_kain as kain,
                sd_finishing as finishing, sd_desain as desain, sd_workshop as workshopKode,
                pab_nama as workshopNama, sd_ket as keterangan, h.user_create as user
            FROM tsodtf_hdr h
            LEFT JOIN kencanaprint.tsales s ON h.sd_sal_kode = s.sal_kode
            LEFT JOIN tcustomer c ON h.sd_cus_kode = c.cus_kode
            LEFT JOIN kencanaprint.tjenisorder jo ON h.sd_jo_kode = jo.jo_kode
            LEFT JOIN kencanaprint.tpabrik p ON h.sd_workshop = p.pab_kode
            WHERE sd_nomor = ?`;

    const [headerRows] = await connection.query(headerQuery, [nomor]);
    if (headerRows.length === 0) return null;

    const header = headerRows[0];

    header.imageUrl = findImageFile(nomor);

    const detailsUkuranQuery =
      "SELECT sdd_ukuran as ukuran, sdd_jumlah as jumlah, sdd_harga as harga FROM tsodtf_dtl WHERE sdd_nomor = ? ORDER BY sdd_nourut";
    const [detailsUkuranRows] = await connection.query(detailsUkuranQuery, [
      nomor,
    ]);

    const detailsTitikQuery =
      "SELECT sdd2_ket as keterangan, sdd2_size as sizeCetak, sdd2_panjang as panjang, sdd2_lebar as lebar FROM tsodtf_dtl2 WHERE sdd2_nomor = ? ORDER BY sdd2_nourut";
    const [detailsTitikRows] = await connection.query(detailsTitikQuery, [
      nomor,
    ]);

    return {
      header: header,
      detailsUkuran: detailsUkuranRows,
      detailsTitik: detailsTitikRows,
    };
  } finally {
    connection.release();
  }
};

/**
 * @description Membuat nomor SO baru (getmaxnomor versi Delphi).
 * @param {object} connection - Koneksi database yang sedang aktif (dalam transaksi).
 * @param {object} data - Data dari form (diperlukan untuk tanggal dan jenis order).
 * @param {object} user - Objek user dari token (diperlukan untuk kode cabang).
 * @returns {Promise<string>} Nomor SO DTF yang baru. Contoh: K01.SD.2509.0001
 */
const generateNewSoNumber = async (connection, data, user) => {
  const tanggal = new Date(data.header.tanggal);
  const branchCode = user.cabang;
  const orderType = data.header.jenisOrderKode;

  if (!branchCode || !orderType) {
    throw new Error(
      "Kode cabang dan jenis order harus ada untuk membuat nomor SO."
    );
  }

  const datePrefix = format(tanggal, "yyMM"); // ex: "2511"
  const fullPrefix = `${branchCode}.${orderType}.${datePrefix}.`; // ex: "K01.SD.2511."
  const prefixLike = `${fullPrefix}%`;
  const totalLength = fullPrefix.length + 4; // ex: prefix length + 4 digits

  // Ambil max dari 4 digit paling kanan, hanya pada rows yang cocok prefix dan panjang total
  const query = `
    SELECT IFNULL(MAX(CAST(RIGHT(sd_nomor, 4) AS UNSIGNED)), 0) AS maxNum
    FROM tsodtf_hdr
    WHERE sd_nomor LIKE ?
      AND CHAR_LENGTH(sd_nomor) = ?
    FOR UPDATE;
  `;

  const [rows] = await connection.query(query, [prefixLike, totalLength]);
  const maxNum = rows[0] && rows[0].maxNum ? Number(rows[0].maxNum) : 0;
  const nextNum = maxNum + 1;

  // Jika ingin memaksa 4 digit (0001..9999)
  const sequentialPart = String(nextNum).padStart(4, "0");

  return `${fullPrefix}${sequentialPart}`;
};

const create = async (data, user) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    // Panggil fungsi generateNewSoNumber untuk mendapatkan nomor baru
    const newNomor = await generateNewSoNumber(connection, data, user);

    const header = data.header;
    // Simpan header dengan nomor baru
    const headerQuery = `INSERT INTO tsodtf_hdr (sd_nomor, sd_tanggal, sd_datekerja, sd_dateline, sd_cus_kode, sd_customer, sd_sal_kode, sd_jo_kode, sd_nama, sd_kain, sd_finishing, sd_desain, sd_workshop, sd_ket, user_create, date_create) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
    await connection.query(headerQuery, [
      newNomor,
      header.tanggal,
      header.tglPengerjaan,
      header.datelineCustomer,
      header.customerKode,
      header.customerNama,
      header.salesKode,
      header.jenisOrderKode,
      header.namaDtf,
      header.kain,
      header.finishing,
      header.desain,
      header.workshopKode,
      header.keterangan,
      user.kode,
    ]);

    // Simpan detail ukuran
    for (const [index, detail] of data.detailsUkuran.entries()) {
      const detailUkuranQuery =
        "INSERT INTO tsodtf_dtl (sdd_nomor, sdd_ukuran, sdd_jumlah, sdd_harga, sdd_nourut) VALUES (?, ?, ?, ?, ?)";
      await connection.query(detailUkuranQuery, [
        newNomor,
        detail.ukuran,
        detail.jumlah,
        detail.harga,
        index + 1,
      ]);
    }

    // Simpan detail titik
    for (const [index, detail] of data.detailsTitik.entries()) {
      const detailTitikQuery =
        "INSERT INTO tsodtf_dtl2 (sdd2_nomor, sdd2_ket, sdd2_size, sdd2_panjang, sdd2_lebar, sdd2_nourut) VALUES (?, ?, ?, ?, ?, ?)";
      await connection.query(detailTitikQuery, [
        newNomor,
        detail.keterangan,
        detail.sizeCetak,
        detail.panjang,
        detail.lebar,
        index + 1,
      ]);
    }

    await connection.commit();
    const [createdHeader] = await connection.query(
      "SELECT *, sales.sal_nama, j.jo_nama, p.pab_nama FROM tsodtf_hdr h LEFT JOIN kencanaprint.tsales sales ON h.sd_sal_kode = sales.sal_kode LEFT JOIN kencanaprint.tjenisorder j ON h.sd_jo_kode = j.jo_kode LEFT JOIN kencanaprint.tpabrik p ON h.sd_workshop = p.pab_kode WHERE sd_nomor = ?",
      [newNomor]
    );
    return {
      message: `Data berhasil disimpan dengan nomor: ${newNomor}`,
      header: createdHeader[0],
    };
  } catch (error) {
    await connection.rollback();
    console.error("Error in create SO DTF service:", error);
    throw new Error("Gagal menyimpan data SO DTF baru.");
  } finally {
    connection.release();
  }
};

const update = async (nomor, data, user) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    const header = data.header;
    const headerQuery = `UPDATE tsodtf_hdr SET sd_tanggal = ?, sd_datekerja = ?, sd_dateline = ?, sd_cus_kode = ?, sd_customer = ?, sd_sal_kode = ?, sd_jo_kode = ?, sd_nama = ?, sd_kain = ?, sd_finishing = ?, sd_desain = ?, sd_workshop = ?, sd_ket = ?, user_modified = ?, date_modified = NOW() WHERE sd_nomor = ?`;
    await connection.query(headerQuery, [
      header.tanggal,
      header.tglPengerjaan,
      header.datelineCustomer,
      header.customerKode,
      header.customerNama,
      header.salesKode,
      header.jenisOrderKode,
      header.namaDtf,
      header.kain,
      header.finishing,
      header.desain,
      header.workshopKode,
      header.keterangan,
      user.kode,
      nomor,
    ]);

    await connection.query("DELETE FROM tsodtf_dtl WHERE sdd_nomor = ?", [
      nomor,
    ]);
    await connection.query("DELETE FROM tsodtf_dtl2 WHERE sdd2_nomor = ?", [
      nomor,
    ]);

    for (const [index, detail] of data.detailsUkuran.entries()) {
      const detailUkuranQuery =
        "INSERT INTO tsodtf_dtl (sdd_nomor, sdd_ukuran, sdd_jumlah, sdd_harga, sdd_nourut) VALUES (?, ?, ?, ?, ?)";
      await connection.query(detailUkuranQuery, [
        nomor,
        detail.ukuran,
        detail.jumlah,
        detail.harga,
        index + 1,
      ]);
    }

    for (const [index, detail] of data.detailsTitik.entries()) {
      const detailTitikQuery =
        "INSERT INTO tsodtf_dtl2 (sdd2_nomor, sdd2_ket, sdd2_size, sdd2_panjang, sdd2_lebar, sdd2_nourut) VALUES (?, ?, ?, ?, ?, ?)";
      await connection.query(detailTitikQuery, [
        nomor,
        detail.keterangan,
        detail.sizeCetak,
        detail.panjang,
        detail.lebar,
        index + 1,
      ]);
    }

    await connection.commit();

    // PERBAIKAN: Panggil findById untuk mendapatkan data lengkap dengan imageUrl
    const updatedData = await findById(nomor);
    return updatedData;
  } catch (error) {
    await connection.rollback();
    console.error(`Error in update SO DTF service for nomor ${nomor}:`, error);
    throw new Error("Gagal memperbarui data SO DTF.");
  } finally {
    connection.release();
  }
};

const searchSales = async (term, page, itemsPerPage) => {
  const searchTerm = `%${term || ""}%`;
  const offset = (page - 1) * itemsPerPage;

  // Query untuk mengambil data dengan limit dan offset
  const dataQuery = `
        SELECT 
            sal_kode AS kode, 
            sal_nama AS nama, 
            sal_alamat AS alamat 
        FROM kencanaprint.tsales
        WHERE sal_aktif = 'Y' 
          AND (sal_kode LIKE ? OR sal_nama LIKE ?)
        ORDER BY sal_nama
        LIMIT ? OFFSET ?
    `;

  // Query untuk menghitung total hasil pencarian
  const countQuery = `
        SELECT COUNT(*) as total
        FROM kencanaprint.tsales
        WHERE sal_aktif = 'Y'
          AND (sal_kode LIKE ? OR sal_nama LIKE ?)
    `;

  const [items] = await pool.query(dataQuery, [
    searchTerm,
    searchTerm,
    itemsPerPage,
    offset,
  ]);
  const [totalRows] = await pool.query(countQuery, [searchTerm, searchTerm]);

  // Kembalikan data dalam format yang diharapkan frontend
  return {
    items: items,
    total: totalRows[0].total,
  };
};

const searchJenisOrder = async (term) => {
  // Query ini meniru logika dari Delphi Anda
  const query = `
        SELECT 
            jo_kode AS kode, 
            jo_nama AS nama
        FROM kencanaprint.tjenisorder
        WHERE jo_divisi = 3
          AND (jo_kode LIKE ? OR jo_nama LIKE ?)
        ORDER BY jo_nama
    `;
  const searchTerm = `%${term || ""}%`;
  const [rows] = await pool.query(query, [searchTerm, searchTerm]);
  return rows;
};

// service/soDtfFormService.js (revisi)
const searchJenisKain = async (term, page = 1, itemsPerPage = 10) => {
  // pastikan angka valid
  const pageNum = Number.isFinite(Number(page)) ? parseInt(page, 10) : 1;
  let limit = Number.isFinite(Number(itemsPerPage))
    ? parseInt(itemsPerPage, 10)
    : 10;

  // jika limit <= 0 atau = -1 => artinya "no limit"
  const noLimit = limit <= 0;

  // pastikan page minimal 1
  const safePage = Math.max(1, pageNum);

  // jika noLimit offset 0 (bukan digunakan)
  const offset = noLimit ? 0 : (safePage - 1) * limit;

  const searchTerm = `%${term || ""}%`;

  // WHERE clause
  const whereClause = `WHERE JenisKain LIKE ?`;

  // hitung total (tetap hitung semua matching rows)
  const countQuery = `SELECT COUNT(*) as total FROM tjeniskain ${whereClause}`;
  const [countRows] = await pool.query(countQuery, [searchTerm]);

  // bangun query data: kalau noLimit, jangan tambahkan LIMIT/OFFSET
  let dataQuery = `
    SELECT 
      JenisKain AS nama,
      Kode
    FROM tjeniskain
    ${whereClause}
    ORDER BY JenisKain
  `;

  let items;
  if (noLimit) {
    // ambil semua
    const [rows] = await pool.query(dataQuery, [searchTerm]);
    items = rows;
  } else {
    dataQuery += ` LIMIT ? OFFSET ?`;
    const [rows] = await pool.query(dataQuery, [searchTerm, limit, offset]);
    items = rows;
  }

  return { items, total: countRows[0].total };
};

const searchWorkshop = async (term) => {
  // Query ini meniru logika dari Delphi Anda
  const query = `
        SELECT 
            pab_kode AS kode, 
            pab_nama AS nama 
        FROM kencanaprint.tpabrik
        WHERE pab_kode <> 'P03'
          AND (pab_kode LIKE ? OR pab_nama LIKE ?)
        ORDER BY pab_nama
    `;
  const searchTerm = `%${term || ""}%`;
  const [rows] = await pool.query(query, [searchTerm, searchTerm]);
  return rows;
};

const getSisaKuota = async (cabang, tanggalKerja) => {
  // Query ini dipecah menjadi 3 sub-query yang lebih sederhana dan standar
  const query = `
        SELECT 
            (SELECT IFNULL(dq_kuota, 0) FROM tdtf_kuota WHERE dq_cab = ?) AS dq_kuota,

            (SELECT IFNULL(SUM(d.sdd_jumlah), 0) 
             FROM tsodtf_hdr h 
             LEFT JOIN tsodtf_dtl d ON d.sdd_nomor = h.sd_nomor 
             WHERE h.sd_jo_kode = 'SD' AND LEFT(h.sd_nomor, 3) = ? AND h.sd_datekerja = ?) AS jumlah,

            (SELECT IFNULL(COUNT(*), 0) 
             FROM tsodtf_hdr j 
             LEFT JOIN tsodtf_dtl2 i ON i.sdd2_nomor = j.sd_nomor 
             WHERE j.sd_jo_kode = 'SD' AND LEFT(j.sd_nomor, 3) = ? AND j.sd_datekerja = ?) AS titik
    `;

  // Parameter tetap sama, berjumlah 5
  const params = [cabang, cabang, tanggalKerja, cabang, tanggalKerja];
  const [rows] = await pool.query(query, params);

  if (rows.length > 0) {
    const { dq_kuota, jumlah, titik } = rows[0];
    // Kalkulasi akhir dilakukan di sini, lebih aman dan mudah dibaca
    const sisa = dq_kuota - jumlah * titik;
    return sisa;
  }

  return 0;
};

/**
 * @description Memproses gambar SO DTF: me-rename dan memindahkan ke folder cabang.
 * @param {string} tempFilePath - Path file sementara dari multer.
 * @param {string} nomorSo - Nomor SO DTF final.
 * @returns {Promise<string>} Path final dari file yang sudah diproses.
 */
const processSoDtfImage = async (tempFilePath, nomorSo) => {
  return new Promise((resolve, reject) => {
    // 1. Pastikan file sumber ada
    if (!fs.existsSync(tempFilePath)) {
      return reject(new Error("File sumber sementara tidak ditemukan."));
    }

    // 2. Siapkan nama file & path tujuan sesuai standar baru
    const cabang = nomorSo.substring(0, 3);
    const finalFileName = `${nomorSo}${path.extname(tempFilePath)}`;

    // Path baru sesuai permintaan Anda
    const branchFolderPath = path.join(
      process.cwd(),
      "public",
      "images",
      cabang
    );

    // 3. Buat folder cabang jika belum ada
    fs.mkdirSync(branchFolderPath, { recursive: true });
    const finalPath = path.join(branchFolderPath, finalFileName);

    // 4. Coba rename file (lebih cepat)
    fs.rename(tempFilePath, finalPath, (err) => {
      if (err) {
        // 5. Jika gagal, coba copy & hapus (lebih aman)
        console.warn(
          `Rename gagal (kode: ${err.code}), mencoba copy & unlink...`
        );
        fs.copyFile(tempFilePath, finalPath, (copyErr) => {
          if (copyErr) {
            return reject(new Error("Gagal menyalin file gambar."));
          }
          fs.unlink(tempFilePath, (unlinkErr) => {
            if (unlinkErr)
              console.error(
                "Peringatan: Gagal menghapus file sementara:",
                tempFilePath
              );
          });
          resolve(finalPath);
        });
      } else {
        resolve(finalPath);
      }
    });
  });
};

/**
 * @description Mengambil daftar master ukuran kaos dari database.
 * @returns {Promise<string[]>} Array berisi nama-nama ukuran.
 */
const getUkuranKaosList = async () => {
  // Query ini meniru logika dari Delphi
  const query = `
        SELECT Ukuran 
        FROM tUkuran 
        WHERE kategori = "" 
        ORDER BY kode
    `;
  const [rows] = await pool.query(query);
  // Ubah array of objects [{Ukuran: 'S'}] menjadi array of strings ['S']
  return rows.map((row) => row.Ukuran);
};

const getUkuranSodtfDetail = async (jenisOrder, ukuran) => {
  const query = `
        SELECT us_panjang AS panjang, us_lebar AS lebar 
        FROM tukuran_sodtf 
        WHERE us_jenis = ? AND us_ukuran = ?
    `;
  const [rows] = await pool.query(query, [jenisOrder, ukuran]);
  return rows.length > 0 ? rows[0] : null;
};

/**
 * @description Menghitung total harga DTG berdasarkan detail titik cetak dan total jumlah kaos.
 * @param {Array} detailsTitik - Array objek dari grid detail titik cetak.
 * @param {number} totalJumlahKaos - Total kuantitas kaos.
 * @returns {Promise<number>} Total harga DTG.
 */
const calculateDtgPrice = async (detailsTitik, totalJumlahKaos) => {
  let totalHarga = 0;
  const query = `
        SELECT us_qty, us_promo, us_harga 
        FROM tukuran_sodtf 
        WHERE us_jenis = 'TG' AND us_ukuran = ?
    `;

  for (const titik of detailsTitik) {
    if (titik.sizeCetak) {
      const [rows] = await pool.query(query, [titik.sizeCetak]);
      if (rows.length > 0) {
        const hargaRule = rows[0];
        if (totalJumlahKaos >= hargaRule.us_qty) {
          totalHarga += hargaRule.us_promo; // Harga promo
        } else {
          totalHarga += hargaRule.us_harga; // Harga reguler
        }
      }
    }
  }
  return totalHarga;
};

const getSizeCetakList = async (jenisOrder) => {
  const query = `
        SELECT us_ukuran AS nama 
        FROM tukuran_sodtf 
        WHERE us_jenis = ? 
        ORDER BY us_ukuran
    `;
  const [rows] = await pool.query(query, [jenisOrder]);
  let results = rows.map((row) => row.nama);

  // Meniru logika Delphi: tambahkan opsi kosong untuk SD dan DP
  if (jenisOrder === "SD" || jenisOrder === "DP") {
    results.unshift(""); // Tambahkan string kosong di awal array
  }
  return results;
};

/**
 * @description Mengambil semua data yang diperlukan untuk mencetak satu SO DTF.
 * @param {string} nomor - Nomor SO DTF.
 * @returns {Promise<object|null>} Objek berisi semua data untuk dicetak.
 */
const getDataForPrint = async (nomor) => {
  // Query ini adalah migrasi langsung dari query di fungsi cetak Delphi Anda
  const query = `
        SELECT 
            h.*, 
            LEFT(h.sd_nomor, 3) AS store,
            g.pab_nama AS gdg_nama,
            o.jo_nama, s.sal_nama AS salesNama,
            DATE_FORMAT(h.date_create, "%d-%m-%Y %T") AS created,
            (SELECT CAST(GROUP_CONCAT(CONCAT(sdd2_nourut, ". ", sdd2_ket, ": P=", sdd2_panjang, "cm L=", sdd2_lebar, "cm") SEPARATOR '\\n') AS CHAR) 
            FROM tsodtf_dtl2 WHERE sdd2_nomor = h.sd_nomor) AS titik,
            (SELECT SUM(sdd_jumlah) FROM tsodtf_dtl WHERE sdd_nomor = h.sd_nomor) AS jumlah,
            (SELECT CAST(GROUP_CONCAT(CONCAT(sdd_ukuran, "=", sdd_jumlah) SEPARATOR ", ") AS CHAR) 
            FROM tsodtf_dtl WHERE sdd_nomor = h.sd_nomor) AS ukuran
        FROM tsodtf_hdr h
        LEFT JOIN kencanaprint.tpabrik g ON g.pab_kode = h.sd_workshop
        LEFT JOIN kencanaprint.tjenisorder o ON h.sd_jo_kode = o.jo_kode
        LEFT JOIN kencanaprint.tsales s ON s.sal_kode = h.sd_sal_kode
        WHERE h.sd_nomor = ?
  `;
  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) return null;

  const data = rows[0]; // --- PERBAIKAN DI SINI --- // Panggil fungsi 'findImageFile' yang sudah benar

  // Hapus logika 'fs.existsSync' yang lama
  data.imageUrl = findImageFile(nomor);
  // --- AKHIR PERBAIKAN ---

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
    const imageUrl = `/images/${cabang}/${fileName}`;
    return imageUrl;
  }

  return null;
};

/**
 * Lookup daftar SO yang sudah DP, untuk dipilih di halaman SO DTF.
 */
const searchSoForDtf = async (term) => {
  const query = `
    SELECT 
      h.so_nomor AS Nomor,
      h.so_tanggal AS Tanggal,
      c.cus_nama AS Customer,
      c.cus_alamat AS Alamat,
      c.cus_kota AS Kota,
      IFNULL(SUM(s.sh_nominal), 0) AS totalBayar,
      IFNULL(h.so_total, 0) AS totalSo
    FROM tso_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
    LEFT JOIN tsetor_hdr s ON s.sh_so_nomor = h.so_nomor
    WHERE h.so_aktif = 'Y'
      AND (h.so_nomor LIKE ? OR c.cus_nama LIKE ?)
    GROUP BY h.so_nomor
    HAVING totalBayar >= totalSo
    ORDER BY h.so_tanggal DESC
    LIMIT 50;
  `;
  const params = [`%${term || ""}%`, `%${term || ""}%`];
  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Ambil detail lengkap 1 SO (header + item + DP), termasuk order custom JSON.
 */
const getSoDetailForDtf = async (nomor) => {
  // === HEADER ===
  const headerQuery = `
    SELECT 
      h.so_nomor AS nomor,
      h.so_tanggal AS tanggal,
      h.so_pen_nomor AS penawaran,
      h.so_ket AS keterangan,
      h.so_sc AS salesCounter,
      h.so_cus_kode AS customerKode,
      c.cus_nama AS customerNama,
      c.cus_alamat AS customerAlamat,
      c.cus_kota AS customerKota,
      c.cus_telp AS customerTelp,
      h.so_cus_level AS levelKode,
      l.level_nama AS levelNama,
      h.so_top AS top,
      h.so_ppn AS ppnPersen,
      h.so_aktif AS statusSo,
      h.so_jenisorder AS jenisOrderKode,
      jo.jo_nama AS jenisOrderNama,
      h.so_namadtf AS namaDtf
    FROM tso_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
    LEFT JOIN tcustomer_level l ON l.level_kode = h.so_cus_level
    LEFT JOIN kencanaprint.tjenisorder jo ON jo.jo_kode = h.so_jenisorder
    WHERE h.so_nomor = ?
  `;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0) return null;
  const header = headerRows[0];

  // === DETAIL ITEM ===
  const itemQuery = `
    SELECT 
      d.sod_kode AS kode,
      COALESCE(
        TRIM(CONCAT(b.brg_jeniskaos, ' ', b.brg_tipe, ' ', b.brg_lengan, ' ', b.brg_jeniskain, ' ', b.brg_warna)),
        d.sod_custom_nama
      ) AS nama,
      d.sod_ukuran AS ukuran,
      d.sod_jumlah AS jumlah,
      d.sod_harga AS harga,
      d.sod_disc AS diskonPersen,
      d.sod_diskon AS diskonRp,
      (d.sod_jumlah * (d.sod_harga - d.sod_diskon)) AS total,
      d.sod_custom,
      d.sod_custom_data,
      d.sod_custom_nama
    FROM tso_dtl d
    LEFT JOIN tbarangdc b ON b.brg_kode = d.sod_kode
    WHERE d.sod_so_nomor = ?
    ORDER BY d.sod_nourut
  `;
  const [itemRows] = await pool.query(itemQuery, [nomor]);

  // === Parse JSON custom order ===
  const itemsParsed = itemRows.map((it) => {
    if (it.sod_custom === "Y" && it.sod_custom_data) {
      try {
        const parsed = JSON.parse(it.sod_custom_data);
        return {
          ...it,
          isCustomOrder: true,
          ukuranKaos: parsed.ukuranKaos || [],
          titikCetak: parsed.titikCetak || [],
        };
      } catch {
        return { ...it, isCustomOrder: true, ukuranKaos: [], titikCetak: [] };
      }
    }
    return { ...it, isCustomOrder: false };
  });

  return { header, items: itemsParsed };
};

module.exports = {
  findById,
  create,
  update,
  searchSales,
  searchJenisOrder,
  searchJenisKain,
  searchWorkshop,
  getSisaKuota,
  processSoDtfImage,
  getUkuranKaosList,
  getUkuranSodtfDetail,
  calculateDtgPrice,
  getSizeCetakList,
  getDataForPrint,
  searchSoForDtf,
  getSoDetailForDtf,
};
