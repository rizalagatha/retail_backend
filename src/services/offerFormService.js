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
      `Nomor penawaran untuk periode ${datePrefix} sudah mencapai maksimum (9999).`
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
      params
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
  const { header, footer, details, user, isNew } = data;
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
        header.tanggal
      );
      idrec = `${header.gudang.kode}PEN${format(
        new Date(),
        "yyyyMMddHHmmssSSS"
      )}`;

      const insertHeaderQuery = `
        INSERT INTO tpenawaran_hdr 
        (pen_idrec, pen_nomor, pen_tanggal, pen_top, pen_ppn, pen_disc, pen_disc1, pen_disc2, 
        pen_bkrm, pen_cus_kode, pen_cus_level, pen_ket, pen_cab, user_create, date_create) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
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
      ]);
    } else {
      const [idrecRows] = await connection.query(
        "SELECT pen_idrec FROM tpenawaran_hdr WHERE pen_nomor = ?",
        [nomorPenawaran]
      );
      if (idrecRows.length === 0)
        throw new Error("Nomor penawaran untuk diupdate tidak ditemukan.");
      idrec = idrecRows[0].pen_idrec;

      const updateHeaderQuery = `
                UPDATE tpenawaran_hdr SET
                pen_tanggal = ?, pen_top = ?, pen_ppn = ?, pen_disc = ?, pen_disc1 = ?, pen_disc2 = ?, pen_bkrm = ?,
                pen_cus_kode = ?, pen_cus_level = ?, pen_ket = ?, user_modified = ?, date_modified = NOW()
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
        nomorPenawaran,
      ]);
    }

    // 2. Hapus detail lama
    await connection.query("DELETE FROM tpenawaran_dtl WHERE pend_nomor = ?", [
      nomorPenawaran,
    ]);

    // 3. Sisipkan detail baru
    for (const [index, item] of details.entries()) {
      const insertDetailQuery = `
                INSERT INTO tpenawaran_dtl
                (pend_idrec, pend_nomor, pend_kode, pend_ph_nomor, pend_sd_nomor, pend_ukuran, pend_jumlah, pend_harga, pend_disc, pend_diskon, pend_nourut)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
      await connection.query(insertDetailQuery, [
        idrec,
        nomorPenawaran,
        item.kode,
        item.noPengajuanHarga || "",
        item.noSoDtf || "",
        item.ukuran,
        item.jumlah,
        item.harga,
        item.diskonPersen,
        item.diskonRp,
        index + 1,
      ]);
    }

    for (const item of details) {
      if (item.pin) {
        // Simpan PIN per item
        const pinItemQuery =
          'INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_barcode, o_created, o_pin, o_nominal) VALUES (?, "PENAWARAN", "DISKON ITEM", ?, NOW(), ?, ?)';
        await connection.query(pinItemQuery, [
          nomorPenawaran,
          item.barcode,
          item.pin,
          item.diskonPersen,
        ]);
      }
    }
    if (footer.pinDiskon1) {
      // Simpan PIN Diskon Faktur 1
      const pinFaktur1Query =
        'INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_created, o_pin, o_nominal) VALUES (?, "PENAWARAN", "DISKON FAKTUR", NOW(), ?, ?)';
      await connection.query(pinFaktur1Query, [
        nomorPenawaran,
        footer.pinDiskon1,
        footer.diskonPersen1,
      ]);
    }
    if (footer.pinDiskon2) {
      // Simpan PIN Diskon Faktur 2
      const pinFaktur2Query =
        'INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_created, o_pin, o_nominal) VALUES (?, "PENAWARAN", "DISKON FAKTUR 2", NOW(), ?, ?)';
      await connection.query(pinFaktur2Query, [
        nomorPenawaran,
        footer.pinDiskon2,
        footer.diskonPersen2,
      ]);
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
  // 1. Ambil data Header
  // Perbaikan: Query ditulis ulang untuk menghindari error "Unknown Column"
  const headerQuery = `
        SELECT 
            h.pen_nomor AS nomor, h.pen_tanggal AS tanggal, h.pen_top AS top, 
            h.pen_ppn AS ppnPersen, h.pen_ket AS keterangan, h.pen_disc1, h.pen_disc2, h.pen_bkrm,
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
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0) {
    throw {
      status: 404,
      message: `Penawaran dengan nomor ${nomor} tidak ditemukan.`,
    };
  }

  const gudangKode = headerRows[0].gdg_kode;

  const headerData = {
    nomor: headerRows[0].nomor,
    tanggal: format(new Date(headerRows[0].tanggal), "yyyy-MM-dd"),
    gudang: { kode: gudangKode, nama: headerRows[0].gdg_nama },
    customer: {
      kode: headerRows[0].cus_kode,
      nama: headerRows[0].cus_nama,
      alamat: headerRows[0].cus_alamat,
      kota: headerRows[0].cus_kota,
      telp: headerRows[0].cus_telp,
      top: headerRows[0].top,
      level: headerRows[0].xlevel,
    },
    top: headerRows[0].top,
    tempo: format(
      addDays(new Date(headerRows[0].tanggal), headerRows[0].top),
      "yyyy-MM-dd"
    ),
    ppnPersen: headerRows[0].ppnPersen,
    keterangan: headerRows[0].keterangan,
  };

  // 2. Ambil data Detail (Items)
  // --- QUERY INI DIMODIFIKASI ---
  const itemsQuery = `
    SELECT 
        d.pend_kode AS kode, IFNULL(b.brgd_barcode, "") AS barcode,
        IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), "") AS nama,
        d.pend_ukuran AS ukuran,
        
        -- ### TAMBAHAN UNTUK STOK ###
        IFNULL(stok.Stok, 0) as stok,
        -- ### AKHIR TAMBAHAN ###
        
        d.pend_jumlah AS jumlah, d.pend_harga AS harga,
        d.pend_disc AS diskonPersen, d.pend_diskon AS diskonRp,
        (d.pend_jumlah * (d.pend_harga - d.pend_diskon)) as total,
        d.pend_ph_nomor as noPengajuanHarga,
        d.pend_sd_nomor as noSoDtf
    FROM tpenawaran_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.pend_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.pend_kode AND b.brgd_ukuran = d.pend_ukuran
    
    -- ### TAMBAHAN UNTUK STOK ###
    LEFT JOIN (
        SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in - mst_stok_out) AS Stok 
        FROM tmasterstok 
        WHERE mst_aktif = "Y" AND mst_cab = ? -- <-- Parameter baru
        GROUP BY mst_brg_kode, mst_ukuran
    ) stok ON stok.mst_brg_kode = d.pend_kode AND stok.mst_ukuran = d.pend_ukuran
    -- ### AKHIR TAMBAHAN ###
    
    WHERE d.pend_nomor = ? ORDER BY d.pend_nourut;
  `;
  const [itemsData] = await pool.query(itemsQuery, [
    gudangKode, // <-- Parameter pertama untuk stok.mst_cab
    nomor, // <-- Parameter kedua untuk d.pend_nomor
  ]);

  // 3. Ambil data Footer
  const footerData = {
    diskonPersen1: headerRows[0].pen_disc1 || 0,
    diskonPersen2: headerRows[0].pen_disc2 || 0,
    biayaKirim: headerRows[0].pen_bkrm || 0,
  };

  return { headerData, itemsData, footerData };
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
    [nomor]
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
  // 1. Ambil data Header, Customer, dan Gudang
  const headerQuery = `
        SELECT 
            h.pen_nomor, h.pen_tanggal, h.pen_ket, h.user_create,
            c.cus_nama, c.cus_alamat, c.cus_telp,
            g.gdg_inv_nama, g.gdg_inv_alamat, g.gdg_inv_kota, g.gdg_inv_telp,
            f.total, f.diskon, f.ppn, f.biaya_kirim, f.grand_total
        FROM tpenawaran_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
        LEFT JOIN tgudang g ON g.gdg_kode = h.pen_cab
        LEFT JOIN (
            SELECT 
                pend_nomor,
                SUM(pend_jumlah * (pend_harga - pend_diskon)) as total,
                (SELECT pen_disc FROM tpenawaran_hdr WHERE pen_nomor = d.pend_nomor) as diskon,
                (SELECT pen_ppn FROM tpenawaran_hdr WHERE pen_nomor = d.pend_nomor) as ppn,
                (SELECT pen_bkrm FROM tpenawaran_hdr WHERE pen_nomor = d.pend_nomor) as biaya_kirim,
                (
                    SUM(pend_jumlah * (pend_harga - pend_diskon)) - 
                    (SELECT pen_disc FROM tpenawaran_hdr WHERE pen_nomor = d.pend_nomor) +
                    ((SELECT pen_ppn FROM tpenawaran_hdr WHERE pen_nomor = d.pend_nomor)/100 * (SUM(pend_jumlah * (pend_harga - pend_diskon)) - (SELECT pen_disc FROM tpenawaran_hdr WHERE pen_nomor = d.pend_nomor))) +
                    (SELECT pen_bkrm FROM tpenawaran_hdr WHERE pen_nomor = d.pend_nomor)
                ) as grand_total
            FROM tpenawaran_dtl d
            WHERE pend_nomor = ?
            GROUP BY pend_nomor
        ) f ON f.pend_nomor = h.pen_nomor
        WHERE h.pen_nomor = ?
    `;
  const [headerRows] = await pool.query(headerQuery, [nomor, nomor]);
  if (headerRows.length === 0) return null;

  // 2. Ambil data Detail
  const detailQuery = `
        SELECT 
            IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), "Jasa Cetak") AS nama_barang,
            d.pend_ukuran AS ukuran,
            d.pend_jumlah AS qty,
            d.pend_harga AS harga,
            d.pend_diskon AS diskon,
            (d.pend_jumlah * (d.pend_harga - d.pend_diskon)) as total
        FROM tpenawaran_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.pend_kode
        WHERE d.pend_nomor = ? 
        ORDER BY d.pend_nourut
    `;
  const [detailRows] = await pool.query(detailQuery, [nomor]);

  return {
    header: headerRows[0],
    details: detailRows,
  };
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
  getDefaultDiscount,
  getOfferForEdit,
  searchAvailableSoDtf,
  getSoDtfDetailsForSo,
  searchApprovedPriceProposals,
  getPriceProposalDetailsForSo,
  getDataForPrint,
  findByBarcode,
};
