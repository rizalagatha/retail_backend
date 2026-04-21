const pool = require("../config/database");
const { format } = require("date-fns");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const findById = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    const headerQuery = `
      SELECT 
          h.sd_nomor as nomor, 
          h.sd_so_nomor AS soNomor, 
          h.sd_tanggal as tanggal, 
          h.sd_sal_kode as salesKode, 
          s.sal_nama as salesNama,
          h.sd_cus_kode as customerKode, 
          h.sd_customer as customerNama, 
          c.cus_alamat as customerAlamat,
          
          -- [PERBAIKAN] Murni ambil dari history sesuai referensi Delphi Mas Rizal
          IFNULL(
            (SELECT CONCAT(h_lvl.clh_level, ' - ', lvl.level_nama) 
             FROM tcustomer_level_history h_lvl
             LEFT JOIN tcustomer_level lvl ON h_lvl.clh_level = lvl.level_kode
             WHERE h_lvl.clh_cus_kode = h.sd_cus_kode 
             ORDER BY h_lvl.clh_tanggal DESC 
             LIMIT 1), 
             ''
          ) AS customerLevel,

          h.sd_jo_kode as jenisOrderKode, 
          jo.jo_nama as jenisOrderNama, 
          h.sd_nama as namaDtf, 
          h.sd_kain as kain,
          h.sd_finishing as finishing, 
          h.sd_desain as desain, 
          h.sd_workshop as workshopKode,
          p.pab_nama as workshopNama, 
          h.sd_ket as keterangan, 
          h.user_create as user,
          
          IFNULL((SELECT r.sd_nomor FROM tsodtf_hdr r WHERE r.sd_ket LIKE CONCAT('%', h.sd_nomor, '%') AND r.sd_nomor NOT LIKE 'TRL-%' LIMIT 1), "") AS noSoDtfRiil
          
      FROM tsodtf_hdr h
      LEFT JOIN kencanaprint.tsales s ON h.sd_sal_kode = s.sal_kode
      LEFT JOIN tcustomer c ON h.sd_cus_kode = c.cus_kode
      -- (JOIN tabel tcustomer_level yang bikin error sebelumnya sudah dihapus)
      LEFT JOIN kencanaprint.tjenisorder jo ON h.sd_jo_kode = jo.jo_kode
      LEFT JOIN kencanaprint.tpabrik p ON h.sd_workshop = p.pab_kode
      WHERE h.sd_nomor = ?`;

    const [headerRows] = await connection.query(headerQuery, [nomor]);
    if (headerRows.length === 0) return null;

    const header = headerRows[0];
    header.imageUrl = findImageFile(nomor);

    // Ambil Riwayat Revisi
    const [revisiRows] = await connection.query(
      `SELECT tr_id, tr_revisi_ke, tr_catatan, tr_gambar, user_create, DATE_FORMAT(date_create, '%d-%m-%Y %H:%i') as tanggal_revisi 
       FROM tsodtf_trial_revisi WHERE tr_nomor = ? ORDER BY tr_revisi_ke ASC`,
      [nomor],
    );
    header.revisiList = revisiRows;

    const detailsUkuranQuery = `
      SELECT sdd_nama_barang AS namaBarang, sdd_ukuran AS ukuran, sdd_jumlah AS jumlah, sdd_harga AS harga
      FROM tsodtf_dtl WHERE sdd_nomor = ? ORDER BY sdd_nourut
    `;
    const [detailsUkuranRows] = await connection.query(detailsUkuranQuery, [
      nomor,
    ]);

    const detailsTitikQuery = `
      SELECT sdd2_ket as keterangan, sdd2_size as sizeCetak, sdd2_panjang as panjang, sdd2_lebar as lebar 
      FROM tsodtf_dtl2 WHERE sdd2_nomor = ? ORDER BY sdd2_nourut
    `;
    const [detailsTitikRows] = await connection.query(detailsTitikQuery, [
      nomor,
    ]);

    return {
      header: header,
      detailsUkuran: detailsUkuranRows,
      detailsTitik: detailsTitikRows,
    };
  } catch (err) {
    console.error("============= ERROR DI FINDBYID =============");
    console.error(err);
    throw err;
  } finally {
    connection.release();
  }
};

const generateNewSoNumber = async (connection, data, user) => {
  const tanggal = new Date(data.header.tanggal);

  // [PERBAIKAN KUNCI] Mutlak pakai user.cabang. Hilangkan fallback ke workshopKode.
  const branchCode = user?.cabang || "K01";
  const orderType = data.header?.jenisOrderKode;

  if (!branchCode || !orderType) {
    throw new Error(
      `Gagal generate nomor! Cabang: ${branchCode}, Jenis Order: ${orderType}`,
    );
  }

  const datePrefix = format(tanggal, "yyMM");
  const fullPrefix = `TRL-${branchCode}.${orderType}.${datePrefix}.`;
  const prefixLike = `${fullPrefix}%`;
  const totalLength = fullPrefix.length + 4;

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

  const sequentialPart = String(nextNum).padStart(4, "0");
  return `${fullPrefix}${sequentialPart}`;
};

const create = async (data, user) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    // [PERBAIKAN KUNCI] Mutlak pakai user.cabang
    const safeCabang = user?.cabang || "K01";
    const safeUser = user?.kode || data.header?.salesKode || "SYSTEM";

    // Lempar user seutuhnya ke generator
    const newNomor = await generateNewSoNumber(connection, data, {
      cabang: safeCabang,
    });
    const headerIdRec = `${safeCabang}TRL${format(new Date(), "yyyyMMddHHmmssSSS")}`;
    const header = data.header;

    const headerQuery = `
      INSERT INTO tsodtf_hdr (
        sd_idrec, sd_nomor, sd_tanggal, sd_datekerja, sd_dateline, 
        sd_cus_kode, sd_customer, sd_sal_kode, sd_jo_kode, 
        sd_so_nomor, sd_nama, sd_kain, sd_finishing, 
        sd_desain, sd_workshop, sd_ket, sd_cab, user_create, date_create,
        sd_trial
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'Y') -- <--- ISI 'Y'
    `;

    await connection.query(headerQuery, [
      headerIdRec,
      newNomor,
      header.tanggal || null,
      header.tanggal || null,
      header.tanggal || null,
      header.customerKode || null,
      header.customerNama || "",
      header.salesKode || null,
      header.jenisOrderKode || null,
      header.soNomor || "",
      header.namaDtf || "",
      header.kain || "",
      header.finishing || "",
      header.desain || "",
      header.workshopKode || null,
      header.keterangan || "",
      safeCabang, // [FIX] Gunakan safeCabang sebagai kepemilikan data (K01)
      safeUser,
    ]);

    // Insert Revisi 0 (Desain Awal)
    await connection.query(
      `INSERT INTO tsodtf_trial_revisi (tr_nomor, tr_revisi_ke, tr_catatan, user_create, date_create) VALUES (?, 0, ?, ?, NOW())`,

      // [FIX] Ubah parameter kedua dari 'header.keterangan' menjadi 'data.newRevision?.catatan'
      [newNomor, data.newRevision?.catatan || "Desain Awal", safeUser],
    );

    const timestamp = format(new Date(), "yyyyMMddHHmmssSSS");

    for (const [index, detail] of data.detailsUkuran.entries()) {
      await connection.query(
        `INSERT INTO tsodtf_dtl (sdd_idrec, sdd_nomor, sdd_ukuran, sdd_jumlah, sdd_harga, sdd_nourut, sdd_nama_barang) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          `${safeCabang}TRL1${timestamp}${index}`,
          newNomor,
          detail.ukuran || "",
          detail.jumlah ?? 0,
          detail.harga ?? 0,
          index + 1,
          detail.namaBarang || "",
        ],
      );
    }

    for (const [index, detail] of data.detailsTitik.entries()) {
      await connection.query(
        `INSERT INTO tsodtf_dtl2 (sdd2_idrec, sdd2_nomor, sdd2_ket, sdd2_size, sdd2_panjang, sdd2_lebar, sdd2_nourut) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          `${safeCabang}TRL2${timestamp}${index}`,
          newNomor,
          detail.keterangan || "",
          detail.sizeCetak || "",
          detail.panjang ?? 0,
          detail.lebar ?? 0,
          index + 1,
        ],
      );
    }

    await connection.commit();
    return {
      message: `TRIAL dibuat: ${newNomor}`,
      nomor: newNomor,
      revisiKe: 0,
    };
  } catch (error) {
    await connection.rollback();
    console.error("============= ERROR CREATE SO TRIAL =============");
    console.error(error);
    throw new Error(error.message || "Gagal menyimpan TRIAL.");
  } finally {
    connection.release();
  }
};

const update = async (nomor, data, user) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const header = data.header;
    const safeUser = user?.kode || header.salesKode || "SYSTEM";
    const timestamp = format(new Date(), "yyyyMMddHHmmssSSS");

    // 1️⃣ Cek Data Lama (Buat tahu apakah Jenis Order diganti)
    const [existingRows] = await connection.query(
      "SELECT sd_jo_kode FROM tsodtf_hdr WHERE sd_nomor = ?",
      [nomor],
    );
    if (existingRows.length === 0)
      throw new Error("Data SO DTF Trial tidak ditemukan.");

    const oldJoKode = existingRows[0].sd_jo_kode;
    let finalNomor = nomor;
    const isOrderTypeChanged = oldJoKode !== header.jenisOrderKode;

    // Jika Jenis Order diganti, Generate Nomor Baru!
    if (isOrderTypeChanged) {
      finalNomor = await generateNewSoNumber(connection, data, user);
    }

    // 2️⃣ UPDATE SEMUA KOLOM (Tanggal, Sales, Customer, Jenis Order juga masuk)
    const headerQuery = `
      UPDATE tsodtf_hdr SET 
        sd_nomor = ?, sd_tanggal = ?, sd_cus_kode = ?, sd_customer = ?, 
        sd_sal_kode = ?, sd_jo_kode = ?, sd_so_nomor = ?, sd_nama = ?, sd_kain = ?, 
        sd_finishing = ?, sd_desain = ?, sd_workshop = ?, sd_ket = ?, 
        user_modified = ?, date_modified = NOW(),
        sd_trial = 'Y'
      WHERE sd_nomor = ?
    `;

    await connection.query(headerQuery, [
      finalNomor,
      header.tanggal,
      header.customerKode,
      header.customerNama,
      header.salesKode,
      header.jenisOrderKode,
      header.soNomor || "",
      header.namaDtf,
      header.kain,
      header.finishing,
      header.desain,
      header.workshopKode,
      header.keterangan,
      safeUser,
      nomor, // Acuannya pakai nomor lama
    ]);

    // 3️⃣ Kelola Revisi Desain
    const isAddingRevision = data.newRevision && data.newRevision.isAdding;
    let nextRevKe = 0;

    if (isAddingRevision) {
      const [revRows] = await connection.query(
        `SELECT IFNULL(MAX(tr_revisi_ke), 0) + 1 as nextRev FROM tsodtf_trial_revisi WHERE tr_nomor = ?`,
        [nomor],
      );
      nextRevKe = revRows[0].nextRev;

      await connection.query(
        `INSERT INTO tsodtf_trial_revisi (tr_nomor, tr_revisi_ke, tr_catatan, user_create, date_create) VALUES (?, ?, ?, ?, NOW())`,
        [finalNomor, nextRevKe, data.newRevision.catatan, safeUser],
      );
    }

    // Jika Nomor Berubah, sesuaikan juga tabel riwayat revisi yang lama agar tetap nyambung
    if (isOrderTypeChanged) {
      await connection.query(
        "UPDATE tsodtf_trial_revisi SET tr_nomor = ? WHERE tr_nomor = ?",
        [finalNomor, nomor],
      );
    }

    // 4️⃣ Hapus & Timpa Detail Ukuran dan Titik
    await connection.query("DELETE FROM tsodtf_dtl WHERE sdd_nomor = ?", [
      nomor,
    ]);
    await connection.query("DELETE FROM tsodtf_dtl2 WHERE sdd2_nomor = ?", [
      nomor,
    ]);

    const detailsUkuran = Array.isArray(data.detailsUkuran)
      ? data.detailsUkuran
      : [];
    for (const [i, det] of detailsUkuran.entries()) {
      const detailIdRec = `${user?.cabang || "K01"}TRL1${timestamp}${i}`;
      await connection.query(
        `INSERT INTO tsodtf_dtl (sdd_idrec, sdd_nomor, sdd_ukuran, sdd_jumlah, sdd_harga, sdd_nourut, sdd_nama_barang) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          detailIdRec,
          finalNomor,
          det.ukuran || "",
          det.jumlah ?? 0,
          det.harga ?? 0,
          i + 1,
          det.namaBarang || "",
        ],
      );
    }

    const detailsTitik = Array.isArray(data.detailsTitik)
      ? data.detailsTitik
      : [];
    for (const [i, det] of detailsTitik.entries()) {
      const detailTitikIdRec = `${user?.cabang || "K01"}TRL2${timestamp}${i}`;
      await connection.query(
        `INSERT INTO tsodtf_dtl2 (sdd2_idrec, sdd2_nomor, sdd2_ket, sdd2_size, sdd2_panjang, sdd2_lebar, sdd2_nourut) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          detailTitikIdRec,
          finalNomor,
          det.keterangan || "",
          det.sizeCetak || "",
          det.panjang ?? 0,
          det.lebar ?? 0,
          i + 1,
        ],
      );
    }

    // 5️⃣ Rename file gambar kalau nomor SO-nya berubah
    if (isOrderTypeChanged) {
      try {
        const cabang = finalNomor.match(/-([A-Z0-9]+)\./)[1];
        const folderPath = path.join(process.cwd(), "public", "images", cabang);
        if (fs.existsSync(folderPath)) {
          const files = fs.readdirSync(folderPath);
          files.forEach((file) => {
            if (file.startsWith(nomor)) {
              // Ganti semua file gambar yang awalannya pakai nomor lama
              const newFileName = file.replace(nomor, finalNomor);
              fs.renameSync(
                path.join(folderPath, file),
                path.join(folderPath, newFileName),
              );
              // Update Path di Database secara silent
              pool
                .query(
                  "UPDATE tsodtf_trial_revisi SET tr_gambar = REPLACE(tr_gambar, ?, ?) WHERE tr_nomor = ?",
                  [nomor, finalNomor, finalNomor],
                )
                .catch((e) => {});
            }
          });
        }
      } catch (imgErr) {
        console.error("Gagal rename gambar SO DTF Trial:", imgErr.message);
      }
    }

    await connection.commit();

    // Kembalikan data utuh
    const resultToReturn = await findById(finalNomor);
    return { ...resultToReturn, revisiKe: nextRevKe };
  } catch (err) {
    await connection.rollback();
    // Bikin PM2 "Cepu" biar enak nge-debug kalau error!
    console.error("\n============= ERROR UPDATE SO TRIAL =============");
    console.error(err);
    console.error("=================================================");
    throw new Error("Gagal menyimpan perubahan.");
  } finally {
    connection.release();
  }
};

const processSoDtfImage = async (tempFilePath, nomorSo, revisiKe) => {
  if (!fs.existsSync(tempFilePath))
    throw new Error("File sumber tidak ditemukan.");

  const cabangMatch = nomorSo.match(/-([A-Z0-9]+)\./);
  const cabang = cabangMatch ? cabangMatch[1] : "K01";

  const finalFileName = `${nomorSo}_rev${revisiKe || 0}.jpg`;

  // [HAPUS ../] Ganti menjadi seperti ini:
  const branchFolderPath = path.join(process.cwd(), "public", "images", cabang);
  if (!fs.existsSync(branchFolderPath))
    fs.mkdirSync(branchFolderPath, { recursive: true });

  const finalPath = path.join(branchFolderPath, finalFileName);

  try {
    await sharp(tempFilePath)
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toFormat("jpeg")
      .jpeg({ quality: 90 })
      .toFile(finalPath);
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    // Update path gambar di database revisi
    const dbPath = `/images/${cabang}/${finalFileName}`;
    await pool.query(
      `UPDATE tsodtf_trial_revisi SET tr_gambar = ? WHERE tr_nomor = ? AND tr_revisi_ke = ?`,
      [dbPath, nomorSo, revisiKe],
    );

    return dbPath;
  } catch (error) {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    throw new Error("Gagal memproses gambar revisi.");
  }
};

const findImageFile = (nomor) => {
  try {
    if (!nomor) return null;
    const cabangMatch = nomor.match(/-([A-Z0-9]+)\./);
    const cabang = cabangMatch ? cabangMatch[1] : "K01";
    const directoryPath = path.join(process.cwd(), "public", "images", cabang);

    if (!fs.existsSync(directoryPath)) return null;

    const files = fs.readdirSync(directoryPath);
    const fileName = files.find((file) => file.startsWith(nomor + "_rev"));
    if (fileName) return `/images/${cabang}/${fileName}`;

    // Fallback ke pencarian biasa jika format rev belum ter-generate
    const fallbackName = files.find((file) => file.startsWith(nomor + "."));
    if (fallbackName) return `/images/${cabang}/${fallbackName}`;

    return null;
  } catch (err) {
    console.error("Error di findImageFile:", err);
    return null;
  }
};

// --- Fungsi Lookup Standar ---
const searchSales = async (term, page, itemsPerPage) => {
  const offset = (page - 1) * itemsPerPage;
  const [items] = await pool.query(
    `SELECT sal_kode AS kode, sal_nama AS nama FROM kencanaprint.tsales WHERE sal_aktif = 'Y' AND (sal_kode LIKE ? OR sal_nama LIKE ?) ORDER BY sal_nama LIMIT ? OFFSET ?`,
    [`%${term}%`, `%${term}%`, itemsPerPage, offset],
  );
  const [[totalRows]] = await pool.query(
    `SELECT COUNT(*) as total FROM kencanaprint.tsales WHERE sal_aktif = 'Y' AND (sal_kode LIKE ? OR sal_nama LIKE ?)`,
    [`%${term}%`, `%${term}%`],
  );
  return { items, total: totalRows.total };
};

const searchJenisOrder = async (term) => {
  const [rows] = await pool.query(
    `SELECT jo_kode AS kode, jo_nama AS nama FROM kencanaprint.tjenisorder WHERE jo_divisi = 3 AND (jo_kode LIKE ? OR jo_nama LIKE ?) ORDER BY jo_nama`,
    [`%${term}%`, `%${term}%`],
  );
  return rows;
};

const searchJenisKain = async (term) => {
  const [rows] = await pool.query(
    `SELECT JenisKain AS nama FROM tjeniskain WHERE JenisKain LIKE ? ORDER BY JenisKain LIMIT 20`,
    [`%${term}%`],
  );
  return { items: rows, total: rows.length };
};

const searchWorkshop = async (term) => {
  const [rows] = await pool.query(
    `SELECT pab_kode AS kode, pab_nama AS nama FROM kencanaprint.tpabrik WHERE pab_kode <> 'P03' AND (pab_kode LIKE ? OR pab_nama LIKE ?) ORDER BY pab_nama`,
    [`%${term}%`, `%${term}%`],
  );
  return rows;
};

const getUkuranKaosList = async () => {
  const [rows] = await pool.query(
    `SELECT Ukuran FROM tUkuran WHERE kategori = "" ORDER BY kode`,
  );
  return rows.map((row) => row.Ukuran);
};

const getUkuranSodtfDetail = async (jenisOrder, ukuran) => {
  const [rows] = await pool.query(
    `SELECT us_panjang AS panjang, us_lebar AS lebar FROM tukuran_sodtf WHERE us_jenis = ? AND us_ukuran = ?`,
    [jenisOrder, ukuran],
  );
  return rows.length > 0 ? rows[0] : null;
};

const calculateDtgPrice = async (detailsTitik, totalJumlahKaos) => {
  let totalHarga = 0;
  for (const titik of detailsTitik) {
    if (titik.sizeCetak) {
      const [rows] = await pool.query(
        `SELECT us_qty, us_promo, us_harga FROM tukuran_sodtf WHERE us_jenis = 'TG' AND us_ukuran = ?`,
        [titik.sizeCetak],
      );
      if (rows.length > 0) {
        totalHarga +=
          totalJumlahKaos >= rows[0].us_qty
            ? rows[0].us_promo
            : rows[0].us_harga;
      }
    }
  }
  return totalHarga;
};

const getSizeCetakList = async (jenisOrder) => {
  const [rows] = await pool.query(
    `SELECT us_ukuran AS nama FROM tukuran_sodtf WHERE us_jenis = ? ORDER BY us_ukuran`,
    [jenisOrder],
  );
  let results = rows.map((row) => row.nama);
  if (jenisOrder === "SD" || jenisOrder === "DP") results.unshift("");
  return results;
};

// Tambahkan 2 fungsi ini di bawah untuk menarik data SO
const searchSoForDtf = async (term, cabang, page, itemsPerPage) => {
  const offset = (page - 1) * itemsPerPage;
  const searchTerm = `%${term || ""}%`;

  const dataQuery = `
    SELECT 
      h.so_nomor AS Nomor, h.so_tanggal AS Tanggal,
      c.cus_nama AS Customer, c.cus_alamat AS Alamat, c.cus_kota AS Kota,
      IFNULL(SUM(s.sh_nominal), 0) AS totalBayar,
      (SELECT SUM(d.sod_jumlah * (d.sod_harga - d.sod_diskon)) FROM tso_dtl d WHERE d.sod_so_nomor = h.so_nomor) AS totalSo
    FROM tso_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
    LEFT JOIN tsetor_hdr s ON s.sh_so_nomor = h.so_nomor
    WHERE h.so_cab = ? AND (h.so_nomor LIKE ? OR c.cus_nama LIKE ?)
    GROUP BY h.so_nomor
    ORDER BY h.so_tanggal DESC LIMIT ? OFFSET ?
  `;

  const [rows] = await pool.query(dataQuery, [
    cabang,
    searchTerm,
    searchTerm,
    itemsPerPage,
    offset,
  ]);

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM (
      SELECT h.so_nomor FROM tso_hdr h LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
      WHERE h.so_cab = ? AND (h.so_nomor LIKE ? OR c.cus_nama LIKE ?) GROUP BY h.so_nomor
    ) x
  `;
  const [[count]] = await pool.query(countQuery, [
    cabang,
    searchTerm,
    searchTerm,
  ]);

  return { items: rows, total: count.total };
};

const getSoDetailForDtf = async (nomor) => {
  const headerQuery = `
    SELECT 
      h.so_nomor AS nomor, h.so_tanggal AS tanggal, h.so_cus_kode AS customerKode,
      c.cus_nama AS customerNama, c.cus_alamat AS customerAlamat, l.level_nama AS levelNama,
      h.so_sc AS salesKode, h.so_jenisorder AS jenisOrderKode, jo.jo_nama AS jenisOrderNama, h.so_namadtf AS namaDtf
    FROM tso_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
    LEFT JOIN tcustomer_level l ON l.level_kode = h.so_cus_level
    LEFT JOIN kencanaprint.tjenisorder jo ON jo.jo_kode = h.so_jenisorder
    WHERE h.so_nomor = ?
  `;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0) return null;

  const itemQuery = `
    SELECT 
      d.sod_kode AS kode, d.sod_ukuran AS ukuran, d.sod_jumlah AS jumlah, d.sod_harga AS harga,
      CASE WHEN d.sod_custom = 'Y' THEN d.sod_custom_nama ELSE b.brg_jeniskaos END AS nama,
      d.sod_custom, d.sod_custom_data, d.sod_custom_nama
    FROM tso_dtl d
    LEFT JOIN tbarangdc b ON b.brg_kode = d.sod_kode
    WHERE d.sod_so_nomor = ? ORDER BY d.sod_nourut
  `;
  const [itemRows] = await pool.query(itemQuery, [nomor]);

  const itemsParsed = itemRows.map((it) => {
    if (it.sod_custom === "Y" && it.sod_custom_data) {
      try {
        const parsed = JSON.parse(it.sod_custom_data);
        return {
          ...it,
          isCustomOrder: true,
          ukuranKaos: parsed.ukuranKaos || [],
          titikCetak: parsed.titikCetak || [],
          sourceItems: parsed.sourceItems || [],
        };
      } catch {
        return {
          ...it,
          isCustomOrder: true,
          ukuranKaos: [],
          titikCetak: [],
          sourceItems: [],
        };
      }
    }
    return { ...it, isCustomOrder: false };
  });

  return { header: headerRows[0], items: itemsParsed };
};

module.exports = {
  findById,
  create,
  update,
  processSoDtfImage,
  searchSales,
  searchJenisOrder,
  searchJenisKain,
  searchWorkshop,
  getUkuranKaosList,
  getUkuranSodtfDetail,
  calculateDtgPrice,
  getSizeCetakList,
  searchSoForDtf,
  getSoDetailForDtf,
};
