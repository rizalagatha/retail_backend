const fs = require("fs");
const path = require("path");
const pool = require("../config/database");
const { format } = require("date-fns");

/**
 * Membuat nomor pengajuan harga baru, meniru getnomor dari Delphi.
 * Format: [Cabang].[Tahun].[Nomor Urut 5 digit] -> K02.2024.00001
 */
const generateNewProposalNumber = async (cabang, tanggal) => {
  const year = format(new Date(tanggal), "yyyy");
  const prefix = `${cabang}.${year}`; // contoh: K02.2025

  const query = `
    SELECT IFNULL(MAX(CAST(RIGHT(ph_nomor, 5) AS UNSIGNED)), 0) AS lastNum
    FROM tpengajuanharga
    WHERE ph_cab = ?
      AND ph_nomor LIKE CONCAT(?, '%')
  `;

  const [rows] = await pool.query(query, [cabang, prefix]);
  const lastNum = parseInt(rows[0].lastNum, 10) || 0;
  const newNum = (lastNum + 1).toString().padStart(5, "0");

  return `${prefix}.${newNum}`; // hasil: K02.2025.00001
};

/**
 * Mencari jenis kaos untuk F1 help.
 */
const searchTshirtTypes = async (term, custom) => {
  let query = "SELECT DISTINCT jk_Jenis AS jenisKaos FROM tjeniskaos";
  const params = [];

  if (custom === "Y") {
    query += ' WHERE jk_custom = "Y"';
  } else {
    query += ' WHERE jk_custom = "N"';
  }

  if (term) {
    query += " AND jk_Jenis LIKE ?";
    params.push(`%${term}%`);
  }
  query += " ORDER BY jk_Jenis";
  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil daftar ukuran dan harga dasar berdasarkan jenis kaos.
 * Mereplikasi logika dari loadjeniskaos di Delphi.
 */
// di file: src/services/priceProposalFormService.js

const getTshirtTypeDetails = async (jenisKaos, custom) => {
  // 1. Siapkan kedua query
  const sizeQuery = `
        SELECT 
            u.ukuran,
            CASE
                WHEN u.ukuran = "S" THEN k.jk_s WHEN u.ukuran = "M" THEN k.jk_m
                WHEN u.ukuran = "L" THEN k.jk_l WHEN u.ukuran = "XL" THEN k.jk_xl
                WHEN u.ukuran = "2XL" THEN k.jk_2xl WHEN u.ukuran = "3XL" THEN k.jk_3xl
                WHEN u.ukuran = "4XL" THEN k.jk_4xl WHEN u.ukuran = "5XL" THEN k.jk_5xl
                ELSE 0
            END AS hargaPcs
        FROM tukuran u
        JOIN tjeniskaos k ON k.jk_Jenis = ? AND k.jk_custom = ?
        WHERE u.kategori = "" AND u.kode >= 2 AND u.kode <= 16
        ORDER BY u.kode;
    `;
  const costsQuery = `
        SELECT bt_tambahan, bt_cm, bt_min 
        FROM tbiayatambahan 
        WHERE bt_tambahan IN ('BORDIR', 'DTF')
    `;

  try {
    // 2. Jalankan kedua query secara paralel untuk efisiensi
    const [[sizeRows], [costRows]] = await Promise.all([
      pool.query(sizeQuery, [jenisKaos, custom]),
      pool.query(costsQuery),
    ]);

    // 3. Gabungkan hasilnya (logika ini tetap sama)
    const costs = {};
    costRows.forEach((row) => {
      if (row.bt_tambahan === "BORDIR") {
        costs.bordir = { cm: row.bt_cm, min: row.bt_min };
      } else if (row.bt_tambahan === "DTF") {
        costs.dtf = { cm: row.bt_cm, min: row.bt_min };
      }
    });

    return {
      sizes: sizeRows,
      costs: costs,
    };
  } catch (error) {
    // Tambahkan log yang lebih detail di sini untuk debugging di masa depan
    console.error(
      `[ERROR] Gagal getTshirtTypeDetails untuk jenisKaos: "${jenisKaos}", custom: "${custom}"`,
    );
    console.error(error); // Cetak error SQL yang sebenarnya ke konsol backend
    throw error; // Lemparkan kembali error agar controller bisa menangkapnya
  }
};

const getDiscountByBruto = async (bruto) => {
  if (!bruto || isNaN(parseFloat(bruto))) {
    // Jika bruto tidak valid atau 0, kembalikan diskon 0
    return 0;
  }

  const query = `
        SELECT diskon 
        FROM tpengajuanharga_diskon 
        WHERE ? >= harga1 AND ? <= harga2
    `;
  const [rows] = await pool.query(query, [bruto, bruto]);

  let diskonRp = 0;
  if (rows.length > 0) {
    const diskonPersen = rows[0].diskon;
    diskonRp = (diskonPersen / 100) * parseFloat(bruto);
  }

  return diskonRp;
};

const searchProductsByType = async (jenisKaos) => {
  // 1. Pecah string menjadi array kata-kata, buang spasi kosong
  const tokens = (jenisKaos || "")
    .split(" ")
    .filter((t) => t.trim().length > 0 && t.toUpperCase() !== "KERAH"); // Abaikan kata "KERAH" jika ada

  let query = `
        SELECT 
            a.brg_kode AS Kode,
            TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna)) AS Nama
        FROM tbarangdc a
        WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
    `;

  const params = [];

  // 2. Tambahkan kondisi LIKE untuk setiap token kata
  if (tokens.length > 0) {
    tokens.forEach((token) => {
      query += ` AND TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain)) LIKE ?`;
      params.push(`%${token}%`);
    });
  }

  query += ` ORDER BY Nama`;

  const [rows] = await pool.query(query, params);
  return rows;
};

const searchAdditionalCosts = async () => {
  // Query ini meniru SQLbantuan dari kode Delphi Anda
  const query = `
        SELECT 
            bt_tambahan AS tambahan,
            bt_harga AS harga 
        FROM tbiayatambahan 
        ORDER BY bt_tambahan
    `;
  const [rows] = await pool.query(query);
  return rows;
};

const getProposalForEdit = async (nomor) => {
  // 1. Ambil data header
  const headerQuery = `
        SELECT h.*, c.cus_nama 
        FROM tpengajuanharga h 
        LEFT JOIN tcustomer c ON c.cus_kode = h.ph_kd_cus 
        WHERE h.ph_nomor = ?
    `;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0) {
    throw new Error("Data pengajuan tidak ditemukan.");
  }

  const cabang = nomor.substring(0, 3);

  // `process.cwd()` adalah cara yang lebih andal untuk mendapatkan root direktori proyek Anda
  const imagePath = path.join(
    process.cwd(),
    "public",
    "images",
    cabang,
    `${nomor}.jpg`,
  );
  let imageUrl = null;

  if (fs.existsSync(imagePath)) {
    // Bangun URL yang benar, sertakan subfolder cabang
    imageUrl = `${
      process.env.BASE_URL || "http://192.168.1.73:8000"
    }/images/${cabang}/${nomor}.jpg`;
  }

  // 2. Ambil data detail ukuran/size
  const sizeQuery = `
        SELECT 
            s.*,
            TRIM(CONCAT_WS(' ', b.brg_jeniskaos, b.brg_tipe, b.brg_lengan, b.brg_jeniskain, b.brg_warna)) AS nama_barang
        FROM tpengajuanharga_size s 
        LEFT JOIN tbarangdc b ON b.brg_kode = s.phs_kode AND b.brg_aktif = 0 AND b.brg_logstok = 'Y'
        WHERE s.phs_nomor = ?
    `;
  const [sizeRows] = await pool.query(sizeQuery, [nomor]);

  // 3. Ambil data bordir
  const bordirQuery = `SELECT * FROM tpengajuanharga_bordir WHERE phb_nomor = ?`;
  const [bordirRows] = await pool.query(bordirQuery, [nomor]);

  // 4. Ambil data DTF
  const dtfQuery = `SELECT * FROM tpengajuanharga_dtf WHERE phd_nomor = ?`;
  const [dtfRows] = await pool.query(dtfQuery, [nomor]);

  // 5. Ambil data biaya tambahan
  const costQuery = `SELECT * FROM tpengajuanharga_tambahan WHERE pht_nomor = ?`;
  const [costRows] = await pool.query(costQuery, [nomor]);

  return {
    header: headerRows[0],
    sizes: sizeRows,
    bordir: bordirRows[0] || {},
    dtf: dtfRows[0] || {},
    additionalCosts: costRows,
    imageUrl: imageUrl,
  };
};

const renameProposalImage = async (tempFilePath, nomor) => {
  return new Promise((resolve, reject) => {
    // Cek apakah file sumber ada
    const fs = require("fs");
    const path = require("path");

    if (!fs.existsSync(tempFilePath)) {
      console.error("Source file does not exist:", tempFilePath);
      return reject(new Error("File sumber tidak ditemukan."));
    }

    // Ambil 3 karakter pertama dari nomor sebagai kode cabang
    const cabang = nomor.substring(0, 3);
    const finalFileName = `${nomor}${path.extname(tempFilePath)}`;

    // Buat path ke folder cabang (misal: .../public/images/K01)
    const branchFolderPath = path.join(
      process.cwd(),
      "public",
      "images",
      cabang,
    );

    // Buat folder cabang jika belum ada
    try {
      fs.mkdirSync(branchFolderPath, { recursive: true });
    } catch (mkdirError) {
      console.error("Error creating directory:", mkdirError);
      return reject(new Error("Gagal membuat direktori gambar."));
    }

    // Tentukan path tujuan final di dalam folder cabang
    const finalPath = path.join(branchFolderPath, finalFileName);

    fs.rename(tempFilePath, finalPath, (err) => {
      if (err) {
        console.error("Gagal me-rename file:", err);
        // Coba copy jika rename gagal (berbeda filesystem)
        fs.copyFile(tempFilePath, finalPath, (copyErr) => {
          if (copyErr) {
            console.error("Gagal copy file:", copyErr);
            return reject(
              new Error("Gagal memproses file gambar: " + copyErr.message),
            );
          }

          // Hapus file sumber setelah copy berhasil
          fs.unlink(tempFilePath, (unlinkErr) => {
            if (unlinkErr) {
              console.warn(
                "Warning: Could not delete temp file:",
                tempFilePath,
              );
            }
          });

          resolve(finalPath);
        });
      } else {
        resolve(finalPath);
      }
    });
  });
};

const saveProposal = async (data) => {
  const {
    header,
    details,
    bordirItems = [],
    dtfItems = [],
    additionalCostItems = [],
    user,
    isNew,
    biayaPerCmBordir,
    bordirMinCharge,
    bordirCost,
    biayaPerCmDtf,
    dtfMinCharge,
    dtfCost,
    footer,
  } = data;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction(); // <-- MULAI TRANSAKSI

    let nomor = header.nomor;
    if (isNew) {
      // Asumsi fungsi generateNewProposalNumber sudah ada di service ini
      nomor = await generateNewProposalNumber(user.cabang, header.tanggal);
    }

    // 1. Simpan/Update Header (tpengajuanharga)
    if (isNew) {
      const headerQuery = `
      INSERT INTO tpengajuanharga 
        (ph_nomor, ph_tanggal, ph_custom, ph_kd_cus, ph_ket, ph_jenis, ph_apv, ph_diskon, ph_cab, user_create, date_create) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     `;
      await connection.query(headerQuery, [
        nomor,
        header.tanggal,
        header.ketersediaan === "Custom" ? "Y" : "N",
        header.customerKode,
        header.keterangan,
        header.jenisKaos,
        header.approval || "",
        footer?.diskon || 0,
        user.cabang, // 👈 ini penting
        user.kode,
      ]);
    } else {
      const headerQuery = `
                UPDATE tpengajuanharga SET 
                    ph_tanggal = ?, ph_custom = ?, ph_kd_cus = ?, ph_ket = ?, ph_jenis = ?, ph_apv = ?, ph_diskon = ?, user_modified = ?, date_modified = NOW() 
                WHERE ph_nomor = ?
            `;
      await connection.query(headerQuery, [
        header.tanggal,
        header.ketersediaan === "Custom" ? "Y" : "N",
        header.customerKode,
        header.keterangan,
        header.jenisKaos,
        header.approval || "",
        footer?.diskon || 0,
        user.kode,
        nomor,
      ]);
    }

    // 2. Hapus detail sizes lama & Simpan detail sizes baru
    await connection.query(
      `DELETE FROM tpengajuanharga_size WHERE phs_nomor = ?`,
      [nomor],
    );

    if (details && details.length > 0) {
      const sizeQuery = `
                INSERT INTO tpengajuanharga_size (phs_nomor, phs_kode, phs_size, phs_jumlah, phs_harga)
                VALUES (?, ?, ?, ?, ?)
            `;
      for (const item of details) {
        if (item.qty > 0) {
          // Hanya simpan yang qty > 0
          await connection.query(sizeQuery, [
            nomor,
            item.kodeBarang || "",
            item.size,
            item.qty,
            item.hargaPcs || 0,
          ]);
        }
      }
    }

    // 3. Hapus biaya tambahan lama & Simpan biaya tambahan baru
    await connection.query(
      `DELETE FROM tpengajuanharga_tambahan WHERE pht_nomor = ?`,
      [nomor],
    );

    if (additionalCostItems && additionalCostItems.length > 0) {
      const costQuery = `
                INSERT INTO tpengajuanharga_tambahan (pht_nomor, pht_jenis, pht_harga)
                VALUES (?, ?, ?)
            `;
      for (const item of additionalCostItems) {
        if (item.tambahan && item.harga > 0) {
          await connection.query(costQuery, [nomor, item.tambahan, item.harga]);
        }
      }
    }

    // 4. Hapus bordir lama & Simpan bordir baru HANYA JIKA ADA DATA
    await connection.query(
      `DELETE FROM tpengajuanharga_bordir WHERE phb_nomor = ?`,
      [nomor],
    );
    // Cek jika ada item bordir yang diisi (p atau l > 0)
    const hasBordirData = bordirItems.some(
      (item) => (item.p || 0) > 0 || (item.l || 0) > 0,
    );
    if (hasBordirData || biayaPerCmBordir > 0 || bordirCost > 0) {
      const bordirQuery = `
                INSERT INTO tpengajuanharga_bordir (phb_nomor, phb_cmbordir, phb_minbordir, phb_rpbordir, phb_bordirp1, phb_bordirl1, phb_bordirp2, phb_bordirl2, phb_bordirp3, phb_bordirl3, phb_bordirp4, phb_bordirl4, phb_bordirp5, phb_bordirl5, phb_bordirp6, phb_bordirl6, phb_bordirp7, phb_bordirl7, phb_bordirp8, phb_bordirl8)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
      await connection.query(bordirQuery, [
        nomor,
        biayaPerCmBordir || 0,
        bordirMinCharge || 0,
        bordirCost || 0,
        bordirItems[0]?.p || 0,
        bordirItems[0]?.l || 0,
        bordirItems[1]?.p || 0,
        bordirItems[1]?.l || 0,
        bordirItems[2]?.p || 0,
        bordirItems[2]?.l || 0,
        bordirItems[3]?.p || 0,
        bordirItems[3]?.l || 0,
        bordirItems[4]?.p || 0,
        bordirItems[4]?.l || 0,
        bordirItems[5]?.p || 0,
        bordirItems[5]?.l || 0,
        bordirItems[6]?.p || 0,
        bordirItems[6]?.l || 0,
        bordirItems[7]?.p || 0,
        bordirItems[7]?.l || 0,
      ]);
    }

    // 5. Hapus DTF lama & Simpan DTF baru HANYA JIKA ADA DATA
    await connection.query(
      `DELETE FROM tpengajuanharga_dtf WHERE phd_nomor = ?`,
      [nomor],
    );
    // Cek jika ada item DTF yang diisi (p atau l > 0)
    const hasDtfData = dtfItems.some(
      (item) => (item.p || 0) > 0 || (item.l || 0) > 0,
    );
    if (hasDtfData || biayaPerCmDtf > 0 || dtfCost > 0) {
      const dtfQuery = `
                INSERT INTO tpengajuanharga_dtf (phd_nomor, phd_cmdtf, phd_mindtf, phd_rpdtf, phd_dtfp1, phd_dtfl1, phd_dtfp2, phd_dtfl2, phd_dtfp3, phd_dtfl3, phd_dtfp4, phd_dtfl4, phd_dtfp5, phd_dtfl5, phd_dtfp6, phd_dtfl6, phd_dtfp7, phd_dtfl7, phd_dtfp8, phd_dtfl8)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
      await connection.query(dtfQuery, [
        nomor,
        biayaPerCmDtf || 0,
        dtfMinCharge || 0,
        dtfCost || 0,
        dtfItems[0]?.p || 0,
        dtfItems[0]?.l || 0,
        dtfItems[1]?.p || 0,
        dtfItems[1]?.l || 0,
        dtfItems[2]?.p || 0,
        dtfItems[2]?.l || 0,
        dtfItems[3]?.p || 0,
        dtfItems[3]?.l || 0,
        dtfItems[4]?.p || 0,
        dtfItems[4]?.l || 0,
        dtfItems[5]?.p || 0,
        dtfItems[5]?.l || 0,
        dtfItems[6]?.p || 0,
        dtfItems[6]?.l || 0,
        dtfItems[7]?.p || 0,
        dtfItems[7]?.l || 0,
      ]);
    }

    await connection.commit(); // <-- SUKSES, SIMPAN SEMUA PERUBAHAN
    return {
      message: `Pengajuan harga ${nomor} berhasil disimpan.`,
      nomor: nomor, // Return nomor untuk keperluan upload image
    };
  } catch (error) {
    await connection.rollback(); // <-- GAGAL, BATALKAN SEMUA PERUBAHAN
    console.error("Save Proposal Error:", error);
    throw new Error("Gagal menyimpan data ke database.");
  } finally {
    connection.release(); // Selalu lepaskan koneksi
  }
};

module.exports = {
  generateNewProposalNumber,
  searchTshirtTypes,
  getTshirtTypeDetails,
  getDiscountByBruto,
  searchProductsByType,
  searchAdditionalCosts,
  getProposalForEdit,
  renameProposalImage,
  saveProposal,
};
