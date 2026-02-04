const pool = require("../config/database");
const path = require("path");
const fs = require("fs");
const { format } = require("date-fns");

const getForEdit = async (nomor, userCabang) => {
  // 1. Ambil data Header
  const headerQuery = `SELECT pc_nomor AS nomor, pc_tanggal AS tanggal, pc_cab AS cabang, pc_acc AS approved FROM tpengajuanbarcode_hdr WHERE pc_nomor = ?`;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0) throw new Error("Dokumen tidak ditemukan.");

  // 2. Ambil data Item Pengajuan (_dtl)
  const itemsQuery = `
    SELECT 
      d.pcd_kode AS kode, b.brgd_barcode AS barcode, d.pcd_ukuran AS ukuran, d.pcd_jumlah AS jumlah,
      b.brgd_harga AS harga, d.pcd_jenis AS jenis, d.pcd_ket AS ket, b.brgd_hpp AS hpp,
      TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
      IFNULL((SELECT SUM(m.mst_stok_in-m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif='Y' AND m.mst_cab=? AND m.mst_brg_kode=d.pcd_kode AND m.mst_ukuran=d.pcd_ukuran), 0) AS stok,
      d2.pcd2_kodein AS kodebaru, 
      d2.pcd2_diskon AS diskon, 
      d2.pcd2_harga AS hargabaru,
      d.pcd_gambar_url  -- Ambil nilai asli dari DB dulu
    FROM tpengajuanbarcode_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.pcd_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.pcd_kode AND b.brgd_ukuran = d.pcd_ukuran
    LEFT JOIN tpengajuanbarcode_dtl2 d2 ON d2.pcd2_nomor = d.pcd_nomor AND d2.pcd2_kode = d.pcd_kode AND d2.pcd2_ukuran = d.pcd_ukuran
    WHERE d.pcd_nomor = ?;
  `;

  // [FIX] Gunakan alias 'cabang' sesuai query di atas, bukan 'pc_cab'
  const headerCab = headerRows[0].cabang;

  // Parameter headerCab sekarang valid (misal: 'K08'), sehingga query stok akan berjalan benar
  const [items] = await pool.query(itemsQuery, [headerCab, nomor]);

  // --- PERBAIKAN PENTING: Lakukan pengecekan fisik file gambar ---
  const processedItems = items.map((item) => {
    // Cek apakah file fisik ada di server menggunakan helper
    const physicalPath = findImageFile(nomor, item.kode, item.ukuran);

    return {
      ...item,
      // Prioritaskan hasil scan fisik. Jika tidak ada, pakai nilai DB (fallback), atau null
      pcd_gambar_url: physicalPath || item.pcd_gambar_url,
    };
  });

  // 3. Ambil data Stiker (_sticker)
  const stickersQuery = `
    SELECT
      s.pcs_kode, s.pcs_kodes, s.pcs_ukuran, s.pcs_jumlah,
      b.brgd_barcode, b.brgd_harga AS harga,
      TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
      IFNULL((SELECT SUM(m.mst_stok_in-m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif='Y' AND m.mst_cab=? AND m.mst_brg_kode=s.pcs_kodes AND m.mst_ukuran=s.pcs_ukuran), 0) AS stok
    FROM tpengajuanbarcode_sticker s
    LEFT JOIN tbarangdc a ON a.brg_kode = s.pcs_kodes
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = s.pcs_kodes AND b.brgd_ukuran = s.pcs_ukuran
    WHERE s.pcs_nomor = ?;
  `;
  const [stickers] = await pool.query(stickersQuery, [userCabang, nomor]);

  // Kembalikan processedItems, bukan items mentah
  return { header: headerRows[0], items: processedItems, stickers };
};

const save = async (payload, user) => {
  const { header, items, stickers, isNew, isApproved } = payload;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let nomorDokumen = header.nomor;

    // --- GENERATE IDREC HEADER ---
    // Format: K03PC20250922153351.608
    const now = new Date();
    // Jika isNew, buat baru. Jika edit, ambil yang lama (opsional, di sini kita buat baru jika belum ada di payload)
    const pc_idrec = isNew
      ? `${user.cabang}PC${format(now, "yyyyMMddHHmmss.SSS")}`
      : (
          await connection.query(
            "SELECT pc_idrec FROM tpengajuanbarcode_hdr WHERE pc_nomor = ?",
            [nomorDokumen],
          )
        )[0][0]?.pc_idrec;

    if (isNew) {
      const yearMonth = new Date(header.tanggal)
        .toISOString()
        .slice(2, 7)
        .replace("-", "");
      const prefix = `${user.cabang}.RJT.${yearMonth}`;

      const nomorQuery = `SELECT IFNULL(MAX(RIGHT(pc_nomor, 5)), 0) + 1 AS next_num FROM tpengajuanbarcode_hdr WHERE LEFT(pc_nomor, 12) = ? FOR UPDATE;`;
      const [nomorRows] = await connection.query(nomorQuery, [prefix]);
      nomorDokumen = `${prefix}${nomorRows[0].next_num
        .toString()
        .padStart(5, "0")}`;

      await connection.query(
        `INSERT INTO tpengajuanbarcode_hdr 
         (pc_idrec, pc_nomor, pc_tanggal, pc_cab, user_create, date_create) 
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [pc_idrec, nomorDokumen, header.tanggal, user.cabang, user.kode],
      );
    }

    if (isApproved) {
      // == ALUR APPROVAL ==
      // 1. Update header dengan status ACC
      await connection.query(
        "UPDATE tpengajuanbarcode_hdr SET pc_acc = ?, date_acc = NOW() WHERE pc_nomor = ?",
        [user.kode, nomorDokumen],
      );

      for (const [index, item] of items.entries()) {
        if (item.hargabaru > 0) {
          const newProductCode =
            item.kodebaru || (await generateNewProductCode(connection));
          const newProductName = `${item.nama} #${item.jenis.substring(0, 1)}`;

          // Insert/Update Master Produk
          await connection.query(
            'INSERT INTO tbarangdc (brg_kode, brg_ktgp, brg_aktif, brg_logstok, brg_kelompok, brg_warna, user_create, date_create) VALUES (?, ?, 0, "Y", "C", ?, ?, NOW()) ON DUPLICATE KEY UPDATE brg_ktgp=VALUES(brg_ktgp), brg_warna=VALUES(brg_warna)',
            [newProductCode, item.jenis, newProductName, user.kode],
          );

          await connection.query(
            "INSERT INTO tbarangdc_dtl (brgd_kode, brgd_barcode, brgd_ukuran, brgd_hpp, brgd_harga) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE brgd_hpp=VALUES(brgd_hpp), brgd_harga=VALUES(brgd_harga)",
            [
              newProductCode,
              newProductCode,
              item.ukuran,
              item.hpp,
              item.hargabaru,
            ],
          );

          // --- GENERATE IDREC DETAIL 2 ---
          // Format: K06PC20250908194748.697
          const detailTime = new Date(now.getTime() + index);
          const timestampDetail = format(detailTime, "yyyyMMddHHmmss.SSS");
          const pcd2_idrec = `${user.cabang}PC${timestampDetail}`;

          // Format: K06PC20250908194748.6971 (tambah digit index)
          // Catatan: index dimulai dari 0, tambah 1 agar digit belakang min 1
          const pcd2_iddrec = `${pcd2_idrec}${index + 1}`;

          await connection.query(
            `INSERT INTO tpengajuanbarcode_dtl2 
             (pcd2_idrec, pcd2_iddrec, pcd2_nomor, pcd2_kode, pcd2_kodein, pcd2_ukuran, pcd2_diskon, pcd2_harga) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE pcd2_diskon=VALUES(pcd2_diskon), pcd2_harga=VALUES(pcd2_harga)`,
            [
              pcd2_idrec,
              pcd2_iddrec,
              nomorDokumen,
              item.kode,
              newProductCode,
              item.ukuran,
              item.diskon,
              item.hargabaru,
            ],
          );
        }
      }
    } else {
      // == ALUR SIMPAN BIASA ==
      await connection.query(
        "UPDATE tpengajuanbarcode_hdr SET pc_tanggal = ?, user_modified = ?, date_modified = NOW() WHERE pc_nomor = ?",
        [header.tanggal, user.kode, nomorDokumen],
      );

      // Hapus detail lama
      await connection.query(
        "DELETE FROM tpengajuanbarcode_dtl WHERE pcd_nomor = ?",
        [nomorDokumen],
      );

      // Insert Detail Baru dengan IDREC
      if (items.length > 0) {
        const itemValues = items.map((item, i) => {
          // --- GENERATE IDREC DETAIL ---
          // Format: K03PC20250922154411.488
          const detailTime = new Date(now.getTime() + i); // timestamp unik per baris
          const timestampDetail = format(detailTime, "yyyyMMddHHmmss.SSS");
          const pcd_idrec = `${user.cabang}PC${timestampDetail}`;

          return [
            pcd_idrec, // [BARU] pcd_idrec
            nomorDokumen,
            item.kode,
            item.ukuran,
            item.jumlah,
            item.jenis,
            item.ket,
            i + 1,
          ];
        });

        await connection.query(
          `INSERT INTO tpengajuanbarcode_dtl 
           (pcd_idrec, pcd_nomor, pcd_kode, pcd_ukuran, pcd_jumlah, pcd_jenis, pcd_ket, pcd_nourut) 
           VALUES ?`,
          [itemValues],
        );
      }

      // (Opsional: Tambahkan logika serupa untuk tpengajuanbarcode_sticker jika tabelnya punya kolom idrec)
    }

    await connection.commit();
    return {
      message: `Pengajuan berhasil disimpan dengan nomor ${nomorDokumen}`,
      nomor: nomorDokumen,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const lookupProducts = async (filters) => {
  const { term, gudang, page, itemsPerPage } = filters;
  const limit = parseInt(itemsPerPage, 10) || 10;
  const pageNum = parseInt(page, 10) || 1;
  const offset = (pageNum - 1) * limit;
  const searchTerm = term ? `%${term}%` : null;

  // Query dari Delphi: a.brg_aktif=0 and a.brg_logstok="Y" and a.brg_kelompok=""
  let fromClause = `
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
    `;
  let whereClause =
    'WHERE a.brg_aktif = 0 AND a.brg_logstok = "Y" AND a.brg_kelompok = ""';
  let params = [];

  if (term) {
    whereClause += ` AND (b.brgd_barcode LIKE ? OR b.brgd_kode LIKE ? OR TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) LIKE ?)`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  const countQuery = `SELECT COUNT(*) as total ${fromClause} ${whereClause}`;
  const [countRows] = await pool.query(countQuery, params);

  // --- PERBAIKAN DI SINI ---
  let dataQuery = `
        SELECT
            b.brgd_barcode AS barcode, b.brgd_kode AS kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran, b.brgd_harga AS harga,
            CONCAT(b.brgd_kode, '-', b.brgd_ukuran) AS uniqueId,
            IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif='Y' AND m.mst_cab=? AND m.mst_brg_kode=b.brgd_kode AND m.mst_ukuran=b.brgd_ukuran), 0) AS stok
        ${fromClause} ${whereClause}
        ORDER BY nama, b.brgd_ukuran
    `;
  // Siapkan parameter awal
  let dataParams = [gudang, ...params];

  // Hanya tambahkan LIMIT jika nilainya positif
  if (limit > 0) {
    dataQuery += ` LIMIT ? OFFSET ?`;
    dataParams.push(limit, offset);
  }
  // --- AKHIR PERBAIKAN ---

  const [items] = await pool.query(dataQuery, dataParams);
  return { items, total: countRows[0].total };
};

const getJenisReject = async () => {
  const [rows] = await pool.query(
    "SELECT jenis FROM tjenisreject ORDER BY jenis",
  );
  return rows.map((r) => r.jenis);
};

const generateNewProductCode = async (connection) => {
  const year = new Date().getFullYear().toString().substring(2);
  const query = `SELECT IFNULL(MAX(LEFT(brg_kode, 6)), 0) AS last_num FROM tbarangdc WHERE brg_kelompok='C' AND RIGHT(brg_kode, 2) = ?;`;
  const [rows] = await connection.query(query, [year]);
  const nextNum = (parseInt(rows[0].last_num, 10) + 1)
    .toString()
    .padStart(6, "0");
  return `${nextNum}${year}`;
};

const getProductDetails = async (filters) => {
  const { kode, ukuran, gudang } = filters;
  const query = `
        SELECT 
            b.brgd_kode AS kode, 
            b.brgd_barcode AS barcode, 
            b.brgd_harga AS harga,
            b.brgd_hpp AS hpp,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                FROM tmasterstok m 
                WHERE m.mst_aktif = 'Y' 
                  AND m.mst_cab = ? 
                  AND m.mst_brg_kode = ? 
                  AND m.mst_ukuran = ?
            ), 0) AS stok
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
        WHERE a.brg_aktif = 0 
          AND b.brgd_kode = ? 
          AND b.brgd_ukuran = ?;
    `;
  const params = [gudang, kode, ukuran, kode, ukuran];
  const [rows] = await pool.query(query, params);
  if (rows.length === 0) {
    throw new Error("Detail produk tidak ditemukan.");
  }
  return rows[0];
};

const lookupStickers = async (filters) => {
  const { term, gudang, page, itemsPerPage } = filters;
  const pageNum = parseInt(page, 10) || 1;
  const limit = parseInt(itemsPerPage, 10) || 10;
  const offset = (pageNum - 1) * limit;
  const searchTerm = term ? `%${term}%` : null;

  // Query dari Delphi: a.brg_kelompok="S"
  let fromClause = `
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
    `;
  // Filter utama untuk stiker
  let whereClause =
    'WHERE a.brg_aktif = 0 AND a.brg_logstok = "Y" AND a.brg_kelompok = "S"';
  let params = [];

  if (term) {
    whereClause += ` AND (b.brgd_barcode LIKE ? OR b.brgd_kode LIKE ? OR TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) LIKE ?)`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  const countQuery = `SELECT COUNT(*) as total ${fromClause} ${whereClause}`;
  const [countRows] = await pool.query(countQuery, params);

  const dataQuery = `
        SELECT
            b.brgd_barcode AS barcode,
            b.brgd_kode AS kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            b.brgd_harga AS harga,
            CONCAT(b.brgd_kode, '-', b.brgd_ukuran) AS uniqueId,
            IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif='Y' AND m.mst_cab=? AND m.mst_brg_kode=b.brgd_kode AND m.mst_ukuran=b.brgd_ukuran), 0) AS stok
        ${fromClause} ${whereClause}
        ORDER BY nama, b.brgd_ukuran LIMIT ? OFFSET ?
    `;
  const dataParams = [gudang, ...params, limit, offset];

  const [items] = await pool.query(dataQuery, dataParams);
  return { items, total: countRows[0].total };
};

const getDataForBarcodePrint = async (nomor) => {
  // Query ini secara langsung mengambil hasil approval dari tabel _dtl2
  // dan mengambil nama barang dari tbarangdc
  const query = `
        SELECT 
            d2.pcd2_kodein AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d2.pcd2_ukuran AS ukuran,
            d2.pcd2_harga AS harga,
            d2.pcd2_jumlah AS jumlah
        FROM tpengajuanbarcode_dtl2 d2
        LEFT JOIN tbarangdc a ON a.brg_kode = d2.pcd2_kode
        WHERE d2.pcd2_nomor = ?;
    `;
  const [rows] = await pool.query(query, [nomor]);

  if (rows.length === 0) {
    throw new Error(
      "Tidak ada data barcode baru yang sudah di-approve untuk dicetak pada dokumen ini.",
    );
  }
  return rows;
};

const processItemImage = async (tempFilePath, nomor, itemKode, itemUkuran) => {
  try {
    const cabang = nomor.substring(0, 3);
    const ext = path.extname(tempFilePath);

    // Buat nama file unik: NOMOR-KODE-UKURAN.ext
    const filename = `${nomor}-${itemKode}-${itemUkuran}${ext}`;

    // Sesuai ingatan saya, target path Anda adalah public/images/cabang
    const targetDir = path.join(process.cwd(), "public", "images", "cabang");
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const finalPath = path.join(targetDir, filename);

    // Pindahkan file dari /temp ke /public/images/cabang
    fs.renameSync(tempFilePath, finalPath);

    // Path yang akan disimpan di DB dan dikirim ke frontend
    const imageUrl = `/images/cabang/${filename}`;

    // Update database
    await pool.query(
      "UPDATE tpengajuanbarcode_dtl SET pcd_gambar_url = ? WHERE pcd_nomor = ? AND pcd_kode = ? AND pcd_ukuran = ?",
      [imageUrl, nomor, itemKode, itemUkuran],
    );

    return { imageUrl };
  } catch (error) {
    // Hapus file temp jika gagal
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    throw new Error(`Gagal memproses gambar: ${error.message}`);
  }
};

/**
 * Mengambil data lengkap untuk Cetak A4 Pengajuan Barcode.
 */
const getDataForPrint = async (nomor) => {
  // 1. Ambil Header + Info Cabang (JOIN tgudang)
  // Kita ambil 3 digit pertama nomor (LEFT(pc_nomor, 3)) untuk join ke tgudang
  const headerQuery = `
    SELECT 
        h.pc_nomor AS nomor, 
        h.pc_tanggal AS tanggal, 
        h.user_create AS usr_ins,
        h.pc_cab AS cabang_kode,
        g.gdg_inv_nama,      -- Nama Perusahaan/Cabang
        g.gdg_inv_alamat,    -- Alamat
        g.gdg_inv_kota,      -- Kota
        g.gdg_inv_telp,      -- Telepon/Fax
        g.gdg_inv_instagram  -- Instagram (opsional)
    FROM tpengajuanbarcode_hdr h
    LEFT JOIN tgudang g ON g.gdg_kode = h.pc_cab
    WHERE h.pc_nomor = ?
  `;

  const [headerRows] = await pool.query(headerQuery, [nomor]);

  if (headerRows.length === 0) {
    throw new Error("Dokumen tidak ditemukan.");
  }
  const header = headerRows[0];

  // 2. Ambil Items (Kaos)
  const itemsQuery = `
    SELECT 
        d.pcd_kode AS kode, 
        d.pcd_ukuran AS ukuran, 
        d.pcd_jumlah AS jumlah,
        d.pcd_jenis AS jenis, 
        d.pcd_ket AS ket, 
        b.brgd_harga AS harga,
        TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
        d.pcd_gambar_url -- Nilai fallback dari database
    FROM tpengajuanbarcode_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.pcd_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.pcd_kode AND b.brgd_ukuran = d.pcd_ukuran
    WHERE d.pcd_nomor = ?
    ORDER BY d.pcd_nourut ASC
  `;
  const [items] = await pool.query(itemsQuery, [nomor]);

  // Proses Gambar untuk setiap item
  const processedItems = items.map((item) => {
    // Cek fisik file di folder server
    const physicalPath = findImageFile(nomor, item.kode, item.ukuran);

    return {
      ...item,
      // Jika ada file fisik, gunakan itu. Jika tidak, gunakan URL dari DB.
      pcd_gambar_url: physicalPath || item.pcd_gambar_url,
    };
  });

  // 3. Ambil Stickers
  const stickersQuery = `
    SELECT
        s.pcs_kode, 
        s.pcs_kodes, 
        s.pcs_ukuran, 
        s.pcs_jumlah,
        b.brgd_harga AS harga,
        TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama
    FROM tpengajuanbarcode_sticker s
    LEFT JOIN tbarangdc a ON a.brg_kode = s.pcs_kodes
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = s.pcs_kodes AND b.brgd_ukuran = s.pcs_ukuran
    WHERE s.pcs_nomor = ?
  `;
  const [stickers] = await pool.query(stickersQuery, [nomor]);

  // Return format JSON lengkap
  return {
    header,
    items: processedItems,
    stickers,
  };
};

const findImageFile = (nomor, kode, ukuran) => {
  // Ekstrak cabang dari nomor (3 huruf pertama)
  const cabang = nomor.substring(0, 3);

  // Path direktori images/cabang
  const directoryPath = path.join(process.cwd(), "public", "images", "cabang");

  if (!fs.existsSync(directoryPath)) {
    return null;
  }

  const files = fs.readdirSync(directoryPath);

  // Cari file yang namanya dimulai dengan NOMOR-KODE-UKURAN
  // Contoh: K06.RJT.2511.0001-TS20250001-XL.jpg
  const prefix = `${nomor}-${kode}-${ukuran}`;
  const fileName = files.find((file) => file.startsWith(prefix));

  if (fileName) {
    return `/images/cabang/${fileName}`; // Kembalikan URL publik
  }

  return null;
};

module.exports = {
  getForEdit,
  save,
  lookupProducts,
  getJenisReject,
  getProductDetails,
  lookupStickers,
  getDataForBarcodePrint,
  processItemImage,
  getDataForPrint,
};
