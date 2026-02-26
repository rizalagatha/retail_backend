const pool = require("../config/database");
const { format, addDays, parseISO } = require("date-fns");
const { get } = require("../routes/salesCounterRoute");

/**
 * @description Membuat nomor Penawaran baru (getmaxnomor versi Delphi).
 */
const generateNewOfferNumber = async (connection, cabang, tanggal) => {
  const yearPart = tanggal.substring(2, 4);
  const monthPart = tanggal.substring(5, 7);
  const datePrefix = yearPart + monthPart;

  const prefix = `${cabang}PEN${datePrefix}`;
  const prefixLength = prefix.length;

  const query = `
    SELECT IFNULL(MAX(CAST(RIGHT(pen_nomor, 4) AS UNSIGNED)), 0) AS maxNum
    FROM tpenawaran_hdr
    WHERE pen_cab = ?
      AND pen_nomor LIKE CONCAT(?, '%')
  `;

  const [rows] = await connection.query(query, [cabang, prefix]);

  // Pastikan hasil query adalah NUMBER
  const maxNum = parseInt(rows[0].maxNum, 10) || 0;
  const nextNum = maxNum + 1;

  // Validasi: Jika nextNum > 9999, throw error
  if (nextNum > 9999) {
    throw new Error(
      `Nomor penawaran untuk periode ${datePrefix} sudah mencapai maksimum (9999).`,
    );
  }

  return `${prefix}${String(nextNum).padStart(4, "0")}`;
};

// Meniru F1 untuk pencarian customer
const searchCustomers = async (term, gudang, page, itemsPerPage, isInvoice) => {
  const offset = (page - 1) * itemsPerPage;
  const searchTerm = `%${term}%`;

  // 1. Inisialisasi parameter kosong
  let params = [];

  // 2. Tentukan logic Retailer
  let retailerFilter = "";
  if (String(isInvoice) === "1") {
    // Jika dari Invoice: JANGAN BLOKIR "RETAIL%".
    // Kita ijinkan semua customer umum + customer khusus cabang ini (cus_cab)
    retailerFilter = ` AND (c.cus_nama NOT LIKE "RETAIL%" OR c.cus_cab = ? OR c.cus_nama LIKE "RETAILER%")`;
    params.push(gudang);
  } else {
    // Jika dari Penawaran/SO: Tetap blokir agar tidak salah pilih
    retailerFilter = ' AND c.cus_nama NOT LIKE "RETAIL%"';
  }

  // 3. Filter Franchise (Tanpa tanda tanya)
  let franchiseFilter =
    gudang === "KPR" ? ' AND c.cus_franchise="Y"' : ' AND c.cus_franchise="N"';

  // 4. Filter Search (Term)
  let searchFilter = "";
  if (term) {
    // Tanda tanya berikutnya (ke-2, 3, 4) ada di sini
    searchFilter = `
      AND (
        c.cus_kode LIKE ? 
        OR c.cus_nama LIKE ?
        OR c.cus_telp LIKE ?
      )
    `;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  // Gabungkan ke Base Query
  const baseQuery = `
        FROM tcustomer c 
        WHERE c.cus_aktif = 0 
        ${retailerFilter}
        ${franchiseFilter}
        ${searchFilter}
    `;

  try {
    // Eksekusi Count (Gunakan params yang sudah disusun berurutan)
    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total ${baseQuery}`,
      params,
    );
    const total = countRows[0].total;

    // Eksekusi Data Query
    const dataQuery = `
        SELECT 
          c.cus_kode AS kode,
          c.cus_nama AS nama,
          c.cus_alamat AS alamat,
          c.cus_kota AS kota,
          c.cus_telp AS telp,
          c.cus_limit AS limitTrans,
          c.cus_top AS top, 
          c.cus_franchise AS franchise,
          IFNULL((
            SELECT l.level_nama
            FROM tcustomer_level_history v
            LEFT JOIN tcustomer_level l ON l.level_kode = v.clh_level
            WHERE v.clh_cus_kode = c.cus_kode
            ORDER BY v.clh_tanggal DESC, v.clh_level DESC 
            LIMIT 1
          ), "") AS level_nama,
          IFNULL((
            SELECT v.clh_level
            FROM tcustomer_level_history v
            WHERE v.clh_cus_kode = c.cus_kode
            ORDER BY v.clh_tanggal DESC, v.clh_level DESC 
            LIMIT 1
          ), "") AS level_kode
        ${baseQuery}
        ORDER BY c.cus_nama
        LIMIT ? OFFSET ?
    `;

    // Tambahkan Limit dan Offset di akhir params (Sangat Penting!)
    const finalParams = [...params, itemsPerPage, offset];
    const [items] = await pool.query(dataQuery, finalParams);

    return { items, total };
  } catch (dbError) {
    console.error("SQL Error:", dbError.message);
    throw dbError;
  }
};

// Meniru edtCusExit untuk mengambil detail customer
const getCustomerDetails = async (kode, gudang) => {
  const query = `
        SELECT 
            c.cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp, c.cus_top, c.cus_franchise,
            IFNULL(CONCAT(x.clh_level, " - " ,x.level_nama), "") AS xlevel,
            lvl.level_diskon, lvl.level_diskon2, lvl.level_nominal
        FROM tcustomer c
        LEFT JOIN (
            SELECT i.clh_cus_kode, i.clh_level, l.level_nama FROM tcustomer_level_history i 
            LEFT JOIN tcustomer_level l ON l.level_kode = i.clh_level
            WHERE i.clh_cus_kode = ? ORDER BY i.clh_tanggal DESC, i.clh_level DESC 
            LIMIT 1
        ) x ON x.clh_cus_kode = c.cus_kode
        LEFT JOIN tcustomer_level lvl ON lvl.level_kode = x.clh_level
        WHERE c.cus_aktif = 0 AND c.cus_nama NOT LIKE "RETAIL%" AND c.cus_kode = ?;
    `;
  const [rows] = await pool.query(query, [kode, kode]);
  if (rows.length === 0) {
    throw new Error("Customer tersebut tidak ada di database.");
  }

  const customer = rows[0];

  // --- Migrasi Logika Validasi dari Delphi ---
  if (!customer.xlevel) {
    throw new Error("Level Customer tersebut belum di-setting.");
  }
  if (gudang === "KPR" && customer.cus_franchise !== "Y") {
    throw new Error("Customer bukan Customer Prioritas.");
  }
  if (gudang !== "KPR" && customer.cus_franchise === "Y") {
    throw new Error("Customer Prioritas hanya bisa transaksi di Store KPR.");
  }

  // Jika semua validasi lolos, kembalikan data lengkap
  return {
    kode: customer.cus_kode,
    nama: customer.cus_nama,
    alamat: customer.cus_alamat,
    kota: customer.cus_kota,
    telp: customer.cus_telp,
    top: customer.cus_top,
    level: customer.xlevel,
    discountRule: {
      diskon1: customer.level_diskon || 0,
      diskon2: customer.level_diskon2 || 0,
      nominal: customer.level_nominal || 0,
    },
  };
};

/**
 * @description Menyimpan data Penawaran (Baru & Ubah).
 */
const saveOffer = async (data) => {
  const { header, footer, details, dps, user, isNew } = data;
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    // Validasi data backend
    if (!header || !header.tanggal) {
      throw new Error("Tanggal penawaran tidak boleh kosong.");
    }

    let nomorPenawaran = header.nomor;
    let idrec;

    // 1. Tentukan nomor & simpan/update data Header
    if (isNew) {
      nomorPenawaran = await generateNewOfferNumber(
        connection,
        header.gudang.kode,
        header.tanggal,
      );
      idrec = `${header.gudang.kode}PEN${format(new Date(), "yyyyMMddHHmmssSSS")}`;

      const insertHeaderQuery = `
        INSERT INTO tpenawaran_hdr 
        (pen_idrec, pen_nomor, pen_tanggal, pen_top, pen_ppn, pen_disc, pen_disc1, pen_disc2, 
        pen_bkrm, pen_cus_kode, pen_cus_level, pen_ket, pen_cab, user_create, date_create,
        pen_jenis_order_kode, pen_jenis_order_nama, pen_nama_dtf, pen_promo_nomor) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?)
      `;
      await connection.query(insertHeaderQuery, [
        idrec,
        nomorPenawaran,
        header.tanggal,
        header.top,
        header.ppnPersen,
        footer.diskonRp,
        footer.diskonPersen1,
        footer.diskonPersen2,
        footer.biayaKirim,
        header.customer.kode,
        header.customer.level.split(" - ")[0],
        header.keterangan,
        user.cabang,
        user.kode,
        header.jenisOrderKode || null,
        header.jenisOrderNama || null,
        header.namaDtf || null,
        header.nomorPromo || null,
      ]);
    } else {
      const [idrecRows] = await connection.query(
        "SELECT pen_idrec FROM tpenawaran_hdr WHERE pen_nomor = ?",
        [nomorPenawaran],
      );
      if (idrecRows.length === 0)
        throw new Error("Nomor penawaran tidak ditemukan.");
      idrec = idrecRows[0].pen_idrec;

      const updateHeaderQuery = `
        UPDATE tpenawaran_hdr SET
        pen_tanggal = ?, pen_top = ?, pen_ppn = ?, pen_disc = ?, pen_disc1 = ?, pen_disc2 = ?, pen_bkrm = ?,
        pen_cus_kode = ?, pen_cus_level = ?, pen_ket = ?, user_modified = ?, date_modified = NOW(),
        pen_jenis_order_kode = ?, pen_jenis_order_nama = ?, pen_nama_dtf = ?, pen_promo_nomor = ?
        WHERE pen_nomor = ?
      `;
      await connection.query(updateHeaderQuery, [
        header.tanggal,
        header.top,
        header.ppnPersen,
        footer.diskonRp,
        footer.diskonPersen1,
        footer.diskonPersen2,
        footer.biayaKirim,
        header.customer.kode,
        header.customer.level.split(" - ")[0],
        header.keterangan,
        user.kode,
        header.jenisOrderKode || null,
        header.jenisOrderNama || null,
        header.namaDtf || null,
        header.nomorPromo || null,
        nomorPenawaran,
      ]);
    }

    // 2. SIMPAN DETAIL (Dukungan Item Custom)
    await connection.query("DELETE FROM tpenawaran_dtl WHERE pend_nomor = ?", [
      nomorPenawaran,
    ]);

    for (const [index, item] of details.entries()) {
      const isCustom =
        item.sod_custom === "Y" || item.kode === "CUSTOM" || item.isCustomOrder;

      let displayUkuran = item.ukuran || "";
      if (isCustom && item.sod_custom_data) {
        try {
          const customData =
            typeof item.sod_custom_data === "string"
              ? JSON.parse(item.sod_custom_data)
              : item.sod_custom_data;

          if (customData.ukuranKaos && Array.isArray(customData.ukuranKaos)) {
            // 1. Gabungkan tanpa spasi agar lebih hemat karakter (misal: "S,M,L,XL,2XL")
            displayUkuran = [
              ...new Set(customData.ukuranKaos.map((u) => u.ukuran)),
            ].join(",");

            // 2. Potong paksa jika masih melebihi batas database (Asumsi batasnya 15 karakter)
            // Sesuaikan angka 15 dengan lebar VARCHAR di database Anda jika berbeda.
            if (displayUkuran.length > 15) {
              displayUkuran = displayUkuran.substring(0, 15);
            }
          }
        } catch (e) {
          console.error("Gagal parse ukuran custom:", e);
        }
      }

      const insertDetailQuery = `
        INSERT INTO tpenawaran_dtl
        (pend_idrec, pend_nomor, pend_kode, pend_ph_nomor, pend_sd_nomor, pend_ukuran, 
        pend_jumlah, pend_harga, pend_disc, pend_diskon, pend_nourut,
        pend_custom, pend_custom_nama, pend_custom_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await connection.query(insertDetailQuery, [
        idrec,
        nomorPenawaran,
        item.kode,
        item.noPengajuanHarga || "",
        item.noSoDtf || "",
        displayUkuran, // Gunakan hasil ekstrak tadi agar kolom pend_ukuran terisi
        item.jumlah,
        item.harga,
        item.diskonPersen || 0,
        item.diskonRp || 0,
        index + 1,
        isCustom ? "Y" : "N",
        isCustom ? item.nama : null,
        isCustom && item.sod_custom_data
          ? typeof item.sod_custom_data === "object"
            ? JSON.stringify(item.sod_custom_data)
            : item.sod_custom_data
          : null,
      ]);
    }

    // 3. SIMPAN LINK DP (Uang Muka)
    // [FIX] Ubah penNomor menjadi nomorPenawaran agar sesuai dengan deklarasi di atas
    if (dps && dps.length > 0) {
      // Bersihkan link lama jika mode update
      await connection.query(
        "DELETE FROM tpenawaran_dp WHERE pnd_nomor_pen = ?",
        [nomorPenawaran], // <-- Perbaikan di sini
      );

      for (const dp of dps) {
        await connection.query(
          "INSERT INTO tpenawaran_dp (pnd_nomor_pen, pnd_nomor_dp) VALUES (?, ?)",
          [nomorPenawaran, dp.nomor], // <-- Perbaikan di sini
        );

        // Update juga agar DP tahu dia milik penawaran ini
        await connection.query(
          "UPDATE tsetor_hdr SET sh_so_nomor = ? WHERE sh_nomor = ?",
          [nomorPenawaran, dp.nomor], // <-- Perbaikan di sini
        );
      }
    }

    // [TAMBAHKAN INI] 3.5. Hapus data otorisasi lama untuk penawaran ini sebelum simpan ulang
    // Ini mencegah error Duplicate Entry saat mode EDIT
    await connection.query(
      "DELETE FROM totorisasi WHERE o_nomor = ? AND o_transaksi = ?",
      [nomorPenawaran, nomorPenawaran], // Gunakan nomor penawaran untuk kedua parameter
    );

    // ========================================================================
    // [BARU] 3.6. UPDATE TRANSAKSI RIIL PADA AUTH DARI HP MANAGER
    // ========================================================================
    const authNomorRef = header.nomorAuth || header.referensiAuth;
    if (authNomorRef && authNomorRef.includes("AUTH")) {
      await connection.query(
        `UPDATE totorisasi SET o_transaksi = ? WHERE o_nomor = ?`,
        [nomorPenawaran, authNomorRef],
      );
    }

    // 4. Simpan Otorisasi Per ITEM (Manual PIN)
    const processedBarcodes = new Set();
    for (const item of details) {
      // Pastikan pin ada dan belum diproses untuk barcode ini
      if (item.pin && !processedBarcodes.has(item.barcode)) {
        const pinItemQuery =
          'INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_barcode, o_created, o_pin, o_nominal) VALUES (?, ?, "DISKON ITEM", ?, NOW(), ?, ?)';
        await connection.query(pinItemQuery, [
          nomorPenawaran,
          nomorPenawaran, // o_transaksi diisi nomor riil
          item.barcode || "", // Pastikan tidak null jika kolom adalah PK
          item.pin,
          item.diskonPersen,
        ]);
        processedBarcodes.add(item.barcode);
      }
    }

    // 5. Simpan Otorisasi DISKON FAKTUR 1 (Manual PIN)
    if (footer.pinDiskon1) {
      await connection.query(
        'INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_barcode, o_created, o_pin, o_nominal) VALUES (?, ?, "DISKON FAKTUR", "", NOW(), ?, ?)',
        [
          nomorPenawaran,
          nomorPenawaran,
          footer.pinDiskon1,
          footer.diskonPersen1,
        ],
      );
    }

    // 6. Simpan Otorisasi DISKON FAKTUR 2 (Manual PIN)
    if (footer.pinDiskon2) {
      await connection.query(
        'INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_barcode, o_created, o_pin, o_nominal) VALUES (?, ?, "DISKON FAKTUR 2", "", NOW(), ?, ?)',
        [
          nomorPenawaran,
          nomorPenawaran,
          footer.pinDiskon2,
          footer.diskonPersen2,
        ],
      );
    }

    await connection.commit();
    return {
      success: true,
      message: `Penawaran ${nomorPenawaran} berhasil disimpan.`,
      nomor: nomorPenawaran,
    };
  } catch (error) {
    await connection.rollback();
    console.error("Error in saveOffer service:", error);
    throw new Error("Terjadi kesalahan saat menyimpan data di server.");
  } finally {
    connection.release();
  }
};

/**
 * @description Menyimpan data DP baru khusus Penawaran.
 * Mengikuti pola saveNewDp milik SO.
 */
const saveOfferDp = async (dpData, user) => {
  const {
    customerKode,
    tanggal,
    jenis,
    nominal,
    keterangan,
    bankData,
    giroData,
    nomorSo, // Ini berisi nomor Penawaran saat dipanggil dari Offer module
  } = dpData;

  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const cabang = user.cabang;

    // 1. Buat nomor setoran: K06.STR.2512.0001
    const datePrefix = format(new Date(tanggal), "yyMM");
    const prefix = `${cabang}.STR.${datePrefix}`;

    const [maxRows] = await connection.query(
      `SELECT IFNULL(MAX(CAST(RIGHT(sh_nomor, 4) AS UNSIGNED)), 0) AS maxNum
       FROM tsetor_hdr
       WHERE sh_cab = ?
         AND sh_nomor LIKE CONCAT(?, '%')`,
      [cabang, prefix],
    );

    const nextNum = (parseInt(maxRows[0].maxNum, 10) || 0) + 1;
    const dpNomor = `${prefix}.${String(nextNum).padStart(4, "0")}`;

    // 2. Siapkan sh_idrec (K06SHyyyymmdd...)
    const idrec = `${cabang}SH${format(new Date(), "yyyyMMddHHmmssSSS")}`;

    // 3. Tentukan jenis (TUNAI: 0, TRANSFER: 1, GIRO: 2)
    const jenisNum = jenis === "TUNAI" ? 0 : jenis === "TRANSFER" ? 1 : 2;

    let query, params;

    if (jenis === "TUNAI") {
      query = `
        INSERT INTO tsetor_hdr (
          sh_idrec, sh_nomor, sh_cus_kode, sh_tanggal, sh_jenis, sh_nominal, 
          sh_ket, sh_cab, sh_so_nomor, sh_otomatis, user_create, date_create
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'N', ?, NOW())
      `;
      params = [
        idrec,
        dpNomor,
        customerKode,
        tanggal,
        jenisNum,
        nominal,
        keterangan || "",
        cabang,
        nomorSo,
        user.kode,
      ];
    } else if (jenis === "TRANSFER") {
      query = `
        INSERT INTO tsetor_hdr (
          sh_idrec, sh_nomor, sh_cus_kode, sh_tanggal, sh_jenis, sh_nominal, 
          sh_akun, sh_norek, sh_tgltransfer, sh_ket, sh_so_nomor, sh_cab, 
          sh_otomatis, user_create, date_create
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N', ?, NOW())
      `;
      params = [
        idrec,
        dpNomor,
        customerKode,
        tanggal,
        jenisNum,
        nominal,
        bankData?.akun || "",
        bankData?.norek || "",
        bankData?.tglTransfer || tanggal,
        keterangan || "",
        nomorSo,
        cabang,
        user.kode,
      ];
    } else if (jenis === "GIRO") {
      query = `
        INSERT INTO tsetor_hdr (
          sh_idrec, sh_nomor, sh_cus_kode, sh_tanggal, sh_jenis, sh_nominal, 
          sh_giro, sh_tglgiro, sh_tempogiro, sh_ket, sh_cab, sh_so_nomor, 
          sh_otomatis, user_create, date_create
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N', ?, NOW())
      `;
      params = [
        idrec,
        dpNomor,
        customerKode,
        tanggal,
        jenisNum,
        nominal,
        giroData?.noGiro || "",
        giroData?.tglGiro || tanggal,
        giroData?.tglJatuhTempo || tanggal,
        keterangan || "",
        cabang,
        nomorSo,
        user.kode,
      ];
    }

    await connection.query(query, params);
    await connection.commit();

    return {
      success: true,
      message: `Setoran DP ${dpNomor} berhasil disimpan.`,
      newDp: { nomor: dpNomor, jenis, nominal, posting: "BELUM" },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const deleteOfferDp = async (nomor) => {
  const [res] = await pool.query(
    "DELETE FROM tsetor_hdr WHERE sh_nomor = ? AND sh_otomatis = 'N'",
    [nomor],
  );
  return { success: true, message: "DP Penawaran berhasil dihapus." };
};

const getDpPrintData = async (nomor) => {
  const query = `
    SELECT h.*, c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp, g.gdg_inv_nama as perush_nama, 
           g.gdg_inv_alamat as perush_alamat, g.gdg_inv_telp as perush_telp
    FROM tsetor_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.sh_cus_kode
    LEFT JOIN tgudang g ON g.gdg_kode = h.sh_cab
    WHERE h.sh_nomor = ?
  `;
  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) return null;

  // Tambahkan logika terbilang di sini atau kirim angka mentah
  return rows[0];
};

const getDefaultDiscount = async (level, total, gudang) => {
  let discount = 0;
  const numericTotal = Number(total) || 0;

  // 1. [PENTING] Jika Total 0 atau minus, diskon PASTI 0.
  // Ini mencegah logic db berjalan jika belum belanja.
  if (numericTotal <= 0) {
    return { discount: 0 };
  }

  // 2. Cek Gudang Khusus (KPR)
  if (gudang === "KPR") {
    return { discount: 15 };
  }

  // 3. Ambil Rule dari Database
  const query =
    "SELECT * FROM tcustomer_level WHERE level_kode = ? OR level_nama = ?";
  const [levelRows] = await pool.query(query, [level, level]);

  if (levelRows.length > 0) {
    const levelData = levelRows[0];

    // Pastikan dikonversi ke Number
    const nominal1 = Number(levelData.level_nominal) || 0; // High Tier (5 Juta)
    const nominal2 = Number(levelData.level_nominal2) || 0; // Low Tier (500 Ribu)

    // --- LOGIKA TIERING (BERTINGKAT) ---

    if (numericTotal >= nominal1) {
      // TIER 1: Lolos batas atas (misal >= 5jt) -> 10%
      discount = levelData.level_diskon;
    } else if (numericTotal >= nominal2) {
      // TIER 2: Gagal batas atas, tapi lolos batas bawah (misal >= 500rb) -> 5%
      discount = levelData.level_diskon2;
    } else {
      // TIER 3: Tidak lolos keduanya (misal < 500rb) -> 0%
      // [FIX] Ini yang sebelumnya terlewat, sehingga retailer dapet 5%
      discount = 0;
    }
  }

  return { discount };
};

/**
 * Mengambil semua data yang diperlukan untuk mode "Ubah Penawaran".
 */
const getOfferForEdit = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    // 1. Ambil data Header (Tambah kolom jenis order & diskon nominal)
    const headerQuery = `
      SELECT 
        h.pen_nomor AS nomor, h.pen_tanggal AS tanggal, h.pen_top AS top, 
        h.pen_ppn AS ppnPersen, h.pen_ket AS keterangan, 
        h.pen_disc1, h.pen_disc2, h.pen_disc, h.pen_bkrm,
        h.pen_jenis_order_kode, h.pen_jenis_order_nama, h.pen_nama_dtf, h.pen_promo_nomor,
        c.cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp,
        (
          SELECT IFNULL(CONCAT(clh_level, " - " ,level_nama), "")
          FROM tcustomer_level_history v 
          LEFT JOIN tcustomer_level l ON l.level_kode = v.clh_level
          WHERE v.clh_cus_kode = h.pen_cus_kode 
          ORDER BY v.clh_tanggal DESC LIMIT 1
        ) AS xlevel,
        g.gdg_kode, g.gdg_nama
      FROM tpenawaran_hdr h
      LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
      LEFT JOIN tgudang g ON g.gdg_kode = h.pen_cab
      WHERE h.pen_nomor = ?;
    `;
    const [headerRows] = await connection.query(headerQuery, [nomor]);
    if (headerRows.length === 0) throw new Error("Penawaran tidak ditemukan.");

    const h = headerRows[0];
    const headerData = {
      nomor: h.nomor,
      tanggal: format(new Date(h.tanggal), "yyyy-MM-dd"),
      gudang: { kode: h.gdg_kode, nama: h.gdg_nama },
      customer: {
        kode: h.cus_kode,
        nama: h.cus_nama,
        alamat: h.cus_alamat,
        kota: h.cus_kota,
        telp: h.cus_telp,
        top: h.top,
        level: h.xlevel,
      },
      top: h.top,
      tempo: format(addDays(new Date(h.tanggal), h.top), "yyyy-MM-dd"),
      ppnPersen: h.ppnPersen,
      keterangan: h.keterangan,
      // Tambahkan kolom jenis order
      jenisOrderKode: h.pen_jenis_order_kode,
      jenisOrderNama: h.pen_jenis_order_nama,
      namaDtf: h.pen_nama_dtf,
      nomorPromo: h.pen_promo_nomor,
    };

    // 2. Ambil data Detail (Items) - Perbaiki Nama untuk item CUSTOM
    const itemsQuery = `
      SELECT 
        d.pend_kode AS kode, IFNULL(b.brgd_barcode, "") AS barcode,
        -- Jika custom, ambil dari pend_custom_nama
        IF(d.pend_custom = 'Y', d.pend_custom_nama, 
           IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), "")
        ) AS nama,
        d.pend_ukuran AS ukuran,
        IFNULL(stok.Stok, 0) as stok,
        d.pend_jumlah AS jumlah, d.pend_harga AS harga,
        d.pend_disc AS diskonPersen, d.pend_diskon AS diskonRp,
        (d.pend_jumlah * (d.pend_harga - d.pend_diskon)) as total,
        d.pend_ph_nomor as noPengajuanHarga,
        d.pend_sd_nomor as noSoDtf,
        -- Tambahkan kolom custom detail
        d.pend_custom, d.pend_custom_nama, d.pend_custom_data
      FROM tpenawaran_dtl d
      LEFT JOIN tbarangdc a ON a.brg_kode = d.pend_kode
      LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.pend_kode AND b.brgd_ukuran = d.pend_ukuran
      LEFT JOIN (
        SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in - mst_stok_out) AS Stok 
        FROM tmasterstok WHERE mst_aktif = "Y" AND mst_cab = ? GROUP BY mst_brg_kode, mst_ukuran
      ) stok ON stok.mst_brg_kode = d.pend_kode AND stok.mst_ukuran = d.pend_ukuran
      WHERE d.pend_nomor = ? ORDER BY d.pend_nourut;
    `;
    const [itemsData] = await connection.query(itemsQuery, [h.gdg_kode, nomor]);

    // 3. Ambil data DP
    const dpQuery = `
      SELECT sk.sh_nomor AS nomor, 
             IF(sk.sh_jenis=0, 'TUNAI', IF(sk.sh_jenis=1, 'TRANSFER', 'GIRO')) AS jenis,
             sk.sh_nominal AS nominal, 'BELUM' as posting, '' as fsk
      FROM tpenawaran_dp link
      JOIN tsetor_hdr sk ON sk.sh_nomor = link.pnd_nomor_dp
      WHERE link.pnd_nomor_pen = ?
    `;
    const [dpItemsData] = await connection.query(dpQuery, [nomor]);

    // 4. Ambil data Footer
    const footerData = {
      diskonPersen1: h.pen_disc1 || 0,
      diskonPersen2: h.pen_disc2 || 0,
      diskonRp: h.pen_disc || 0,
      biayaKirim: h.pen_bkrm || 0,
    };

    return { headerData, itemsData, dpItemsData, footerData };
  } finally {
    connection.release();
  }
};

/**
 * @description Mencari SO DTF yang belum dipakai untuk Penawaran.
 */
const searchAvailableSoDtf = async (filters) => {
  const { cabang, customerKode, term } = filters;
  const searchTerm = `%${term}%`;
  const query = `
        SELECT 
            h.sd_nomor AS nomor,
            h.sd_tanggal AS tanggal,
            h.sd_nama AS namaDtf,
            h.sd_ket AS keterangan
        FROM tsodtf_hdr h
        WHERE h.sd_stok = "" AND h.sd_alasan = "" 
          AND h.sd_cab = ?
          AND h.sd_cus_kode = ?
          AND h.sd_nomor NOT IN (
              SELECT DISTINCT o.sod_sd_nomor FROM tso_dtl o WHERE o.sod_sd_nomor IS NOT NULL AND o.sod_sd_nomor <> ''
              UNION ALL
              SELECT DISTINCT i.invd_sd_nomor FROM tinv_dtl i WHERE i.invd_sd_nomor IS NOT NULL AND i.invd_sd_nomor <> ''
          )
          AND (h.sd_nomor LIKE ? OR h.sd_nama LIKE ?)
        ORDER BY h.sd_tanggal DESC
    `;
  const [rows] = await pool.query(query, [
    cabang,
    customerKode,
    searchTerm,
    searchTerm,
  ]);
  return rows;
};

/**
 * @description Mengambil semua detail dari SO DTF untuk diimpor.
 */
const getSoDtfDetailsForSo = async (nomor) => {
  const query = `
        SELECT 
            h.sd_nomor,
            h.sd_nama AS nama,
            d.sdd_ukuran AS ukuran,
            d.sdd_jumlah AS jumlah,
            d.sdd_harga AS harga,
            (d.sdd_jumlah * d.sdd_harga) AS total
        FROM tsodtf_dtl d
        JOIN tsodtf_hdr h ON h.sd_nomor = d.sdd_nomor
        WHERE d.sdd_nomor = ?
        ORDER BY d.sdd_nourut
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

/**
 * @description Mencari Pengajuan Harga yang sudah disetujui.
 */
const searchApprovedPriceProposals = async (params) => {
  const { cabang, customerKode, term } = params;
  const searchTerm = `%${term}%`;
  const query = `
        SELECT 
            h.ph_nomor AS nomor,
            h.ph_tanggal AS tanggal,
            c.cus_nama AS customer,
            h.ph_jenis AS jenisKaos,
            h.ph_ket AS keterangan
        FROM tpengajuanharga h
        LEFT JOIN tcustomer c ON c.cus_kode = h.ph_kd_cus
        WHERE h.ph_kd_cus = ?
          AND h.ph_apv <> ""
          AND h.ph_cab = ?
          AND (h.ph_nomor LIKE ? OR h.ph_ket LIKE ?)
        ORDER BY h.ph_nomor DESC
    `;
  const [rows] = await pool.query(query, [
    customerKode,
    cabang,
    searchTerm,
    searchTerm,
  ]);
  return rows;
};

/**
 * @description Mengambil semua detail dari Pengajuan Harga untuk diimpor.
 */
const getPriceProposalDetailsForSo = async (nomor) => {
  // 1. Ambil Header
  const [headerRows] = await pool.query(
    "SELECT * FROM tpengajuanharga WHERE ph_nomor = ?",
    [nomor],
  );
  if (headerRows.length === 0)
    throw new Error("Data Pengajuan Harga tidak ditemukan.");

  // 2. Ambil Detail
  const detailQuery = `
        SELECT 
            d.phs_kode AS kode,
            b.brgd_barcode as barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d.phs_size AS ukuran,
            d.phs_jumlah AS jumlah,
            (d.phs_harga + IFNULL(t.tambahan, 0) + IFNULL(brd.bordir, 0) + IFNULL(dt.dtf, 0)) AS harga,
            (d.phs_jumlah * (d.phs_harga + IFNULL(t.tambahan, 0) + IFNULL(brd.bordir, 0) + IFNULL(dt.dtf, 0))) as total,
            IFNULL(stok.Stok, 0) as stok
        FROM tpengajuanharga_size d
        LEFT JOIN tpengajuanharga h ON h.ph_nomor = d.phs_nomor
        LEFT JOIN tbarangdc a ON a.brg_kode = d.phs_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.phs_kode AND b.brgd_ukuran = d.phs_size
        LEFT JOIN (SELECT pht_nomor, SUM(pht_harga) AS tambahan FROM tpengajuanharga_tambahan GROUP BY pht_nomor) t ON t.pht_nomor = d.phs_nomor
        LEFT JOIN (SELECT phb_nomor, phb_rpbordir AS bordir FROM tpengajuanharga_bordir GROUP BY phb_nomor) brd ON brd.phb_nomor = d.phs_nomor
        LEFT JOIN (SELECT phd_nomor, phd_rpdtf AS dtf FROM tpengajuanharga_dtf GROUP BY phd_nomor) dt ON dt.phd_nomor = d.phs_nomor
        LEFT JOIN (
            SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in - mst_stok_out) AS Stok 
            FROM tmasterstok 
            WHERE mst_aktif = "Y" AND mst_cab = ?
            GROUP BY mst_brg_kode, mst_ukuran
        ) stok ON stok.mst_brg_kode = d.phs_kode AND stok.mst_ukuran = d.phs_size
        WHERE d.phs_nomor = ?
    `;
  const [detailRows] = await pool.query(detailQuery, [nomor, nomor]);

  return { headerData: headerRows[0], itemsData: detailRows };
};

/**
 * @description Mengambil semua data yang diperlukan untuk mencetak satu Penawaran.
 * @param {string} nomor - Nomor Penawaran.
 * @returns {Promise<object|null>} Objek berisi semua data untuk dicetak.
 */
const getDataForPrint = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    // 1. Ambil Header + Customer + Info Jenis Order
    const [headerRows] = await connection.query(
      `
        SELECT h.*, c.cus_nama, c.cus_alamat, c.cus_telp,
               h.pen_jenis_order_nama, h.pen_nama_dtf
        FROM tpenawaran_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
        WHERE h.pen_nomor = ?
    `,
      [nomor],
    );

    if (headerRows.length === 0) return null;
    const header = headerRows[0];

    // 2. Ambil Info Gudang
    const [gudangRows] = await connection.query(
      `SELECT gdg_inv_nama, gdg_inv_alamat, gdg_inv_kota, gdg_inv_telp, gdg_akun, gdg_transferbank 
       FROM tgudang WHERE gdg_kode = ?`,
      [header.pen_cab],
    );
    const gudang = gudangRows[0];

    // 3. Ambil Detail (Query dibersihkan dari JSON_TABLE yang bermasalah)
    const [rawDetails] = await connection.query(
      `
        SELECT 
            d.pend_kode AS kode, 
            CASE 
                WHEN d.pend_custom = 'Y' AND NULLIF(d.pend_custom_nama, '') IS NOT NULL 
                    THEN d.pend_custom_nama 
                ELSE IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), "Jasa Cetak")
            END AS nama_barang,
            d.pend_ukuran AS ukuran, 
            d.pend_jumlah AS qty, 
            d.pend_harga AS harga,
            d.pend_diskon AS diskon, 
            (d.pend_jumlah * (d.pend_harga - d.pend_diskon)) as total,
            d.pend_custom,
            d.pend_custom_data -- Ambil raw JSON untuk diproses di JS
        FROM tpenawaran_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.pend_kode
        WHERE d.pend_nomor = ? 
        ORDER BY d.pend_nourut
    `,
      [nomor],
    );

    // --- LOGIKA BARU: Proses Ukuran Custom di JavaScript ---
    const details = rawDetails.map((item) => {
      let displayUkuran = item.ukuran;

      // Jika ukuran kosong dan ini barang custom, ekstrak dari JSON_DATA
      if (
        (!displayUkuran || displayUkuran === "") &&
        item.pend_custom === "Y" &&
        item.pend_custom_data
      ) {
        try {
          const customObj =
            typeof item.pend_custom_data === "string"
              ? JSON.parse(item.pend_custom_data)
              : item.pend_custom_data;

          if (customObj.ukuranKaos && Array.isArray(customObj.ukuranKaos)) {
            // Ambil daftar ukuran unik, misal: "L, XL"
            displayUkuran = [
              ...new Set(customObj.ukuranKaos.map((u) => u.ukuran)),
            ].join(", ");
          }
        } catch (e) {
          console.error("Gagal parse pend_custom_data:", e);
        }
      }

      return {
        nama_barang: item.nama_barang,
        ukuran: displayUkuran,
        qty: item.qty,
        harga: item.harga,
        diskon: item.diskon,
        total: item.total,
      };
    });

    // 4. Ambil Rincian DP (Uang Muka)
    const [dps] = await connection.query(
      `
        SELECT sk.sh_nomor AS nomor, 
               CASE WHEN sk.sh_jenis = 0 THEN 'TUNAI' WHEN sk.sh_jenis = 1 THEN 'TRANSFER' ELSE 'GIRO' END AS jenis, 
               sk.sh_nominal AS nominal
        FROM tpenawaran_dp link
        JOIN tsetor_hdr sk ON sk.sh_nomor = link.pnd_nomor_dp
        WHERE link.pnd_nomor_pen = ?
    `,
      [nomor],
    );

    // 5. Kalkulasi Total
    const total_bruto = details.reduce(
      (sum, item) => sum + Number(item.total),
      0,
    );
    const diskon_faktur = Number(header.pen_disc || 0);
    const netto = total_bruto - diskon_faktur;
    const ppn_rp = (header.pen_ppn / 100) * netto;
    const grand_total = netto + ppn_rp + Number(header.pen_bkrm || 0);
    const total_dp = dps.reduce((sum, dp) => sum + Number(dp.nominal), 0);

    return {
      header: {
        ...header,
        ...gudang,
        total: total_bruto,
        diskon: diskon_faktur,
        ppn: ppn_rp,
        biaya_kirim: Number(header.pen_bkrm || 0),
        grand_total: grand_total,
        total_dp: total_dp,
        belum_dibayar: grand_total - total_dp,
      },
      details,
      dps: dps || [],
    };
  } finally {
    connection.release();
  }
};

const findByBarcode = async (barcode, gudang) => {
  const query = `
        SELECT
            d.brgd_barcode AS barcode,
            d.brgd_kode AS kode,
            TRIM(CONCAT(h.brg_jeniskaos, " ", h.brg_tipe, " ", h.brg_lengan, " ", h.brg_jeniskain, " ", h.brg_warna)) AS nama,
            d.brgd_ukuran AS ukuran,
            d.brgd_harga AS harga,
            
            -- Logika perhitungan stok dari Delphi menggunakan tmasterstok --
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                FROM tmasterstok m 
                WHERE m.mst_aktif = 'Y' 
                  AND m.mst_cab = ? 
                  AND m.mst_brg_kode = d.brgd_kode 
                  AND m.mst_ukuran = d.brgd_ukuran
            ), 0) AS stok

        FROM tbarangdc_dtl d
        LEFT JOIN tbarangdc h ON h.brg_kode = d.brgd_kode
        WHERE h.brg_aktif = 0 
          AND h.brg_logstok <> 'N'
          AND d.brgd_barcode = ?;
    `;

  // Parameter 'gudang' sekarang digunakan untuk subquery stok
  const [rows] = await pool.query(query, [gudang, barcode]);

  if (rows.length === 0) {
    throw new Error("Barcode tidak ditemukan atau barang tidak aktif.");
  }
  return rows[0];
};

module.exports = {
  generateNewOfferNumber,
  searchCustomers,
  getCustomerDetails,
  saveOffer,
  deleteOfferDp,
  saveOfferDp,
  getDpPrintData,
  getDefaultDiscount,
  getOfferForEdit,
  searchAvailableSoDtf,
  getSoDtfDetailsForSo,
  searchApprovedPriceProposals,
  getPriceProposalDetailsForSo,
  getDataForPrint,
  findByBarcode,
};
