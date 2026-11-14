const pool = require("../config/database");
const { format, addDays, parseISO } = require("date-fns");
const { normalizeTelp } = require("./customerService");
const {
  UKURAN_CETAK,
  WARNA_KAOS,
  getJasa,
  labelSizeCetak,
  hitungEstimasi,
} = require("./jasaCustomTarif");
const { findOrCreateOnlineCustomer } = require("./customerService");
const {
  getPublicStores,
  getPublicStockLive,
  getPromoDiskonMap,
  hargaSetelahPromo,
  promoKey,
  PAMERAN_BRANCHES,
} = require("./soService");

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

  const maxNum = parseInt(rows[0].maxNum, 10) || 0;
  const nextNum = maxNum + 1;

  if (nextNum > 9999) {
    throw new Error(
      `Nomor penawaran untuk periode ${datePrefix} sudah mencapai maksimum (9999).`,
    );
  }

  return `${prefix}${String(nextNum).padStart(4, "0")}`;
};

const searchCustomers = async (term, gudang, page, itemsPerPage, isInvoice) => {
  const offset = (page - 1) * itemsPerPage;
  const searchTerm = `%${term}%`;

  let params = [];

  let retailerFilter = "";
  if (String(isInvoice) === "1") {
    retailerFilter = ` AND (c.cus_nama NOT LIKE "RETAIL%" OR c.cus_cab = ? OR c.cus_nama LIKE "RETAILER%")`;
    params.push(gudang);
  } else {
    retailerFilter = ' AND c.cus_nama NOT LIKE "RETAIL%"';
  }

  let franchiseFilter =
    gudang === "KPR" ? ' AND c.cus_franchise="Y"' : ' AND c.cus_franchise="N"';

  let searchFilter = "";
  if (term) {
    const cleanPhoneTerm = `%${term.replace(/[\s-]/g, "")}%`;
    const searchTerm = `%${term}%`;

    searchFilter = `
      AND (
        c.cus_kode LIKE ? 
        OR c.cus_nama LIKE ?
        OR REPLACE(REPLACE(c.cus_telp, ' ', ''), '-', '') LIKE ?
      )
    `;
    params.push(searchTerm, searchTerm, cleanPhoneTerm);
  }

  const baseQuery = `
        FROM tcustomer c 
        WHERE c.cus_aktif = 0 
        ${retailerFilter}
        ${franchiseFilter}
        ${searchFilter}
    `;

  try {
    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total ${baseQuery}`,
      params,
    );
    const total = countRows[0].total;

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

    const finalParams = [...params, itemsPerPage, offset];
    const [items] = await pool.query(dataQuery, finalParams);

    return { items, total };
  } catch (dbError) {
    console.error("SQL Error:", dbError.message);
    throw dbError;
  }
};

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

  if (!customer.xlevel) {
    throw new Error("Level Customer tersebut belum di-setting.");
  }
  if (gudang === "KPR" && customer.cus_franchise !== "Y") {
    throw new Error("Customer bukan Customer Prioritas.");
  }
  if (gudang !== "KPR" && customer.cus_franchise === "Y") {
    throw new Error("Customer Prioritas hanya bisa transaksi di Store KPR.");
  }

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
  const { header, footer, details, dps, user, isNew, tipeKunjungan } = data;
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    if (!header || !header.tanggal) {
      throw new Error("Tanggal penawaran tidak boleh kosong.");
    }

    let nomorPenawaran = header.nomor;

    if (!isNew) {
      const [existingSo] = await connection.query(
        "SELECT so_nomor FROM tso_hdr WHERE so_pen_nomor = ?",
        [nomorPenawaran],
      );

      if (existingSo.length > 0) {
        throw new Error(
          `Penawaran ${nomorPenawaran} sudah pernah dibuatkan SO (${existingSo[0].so_nomor}).`,
        );
      }
    }

    let idrec;

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
        Number(footer.diskonPersen1) || 0,
        Number(footer.diskonPersen2) || 0,
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
        Number(footer.diskonPersen1) || 0,
        Number(footer.diskonPersen2) || 0,
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

    if (
      tipeKunjungan &&
      (tipeKunjungan === "STORE" || tipeKunjungan === "WA")
    ) {
      try {
        await connection.query(
          `INSERT IGNORE INTO tkunjungan_customer 
           (tanggal, cabang, cus_kode, tipe_kunjungan, sumber_dokumen, nomor_dokumen, user_create) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            header.tanggal,
            user.cabang,
            header.customer.kode,
            tipeKunjungan,
            "PENAWARAN",
            nomorPenawaran,
            user.kode,
          ],
        );
      } catch (visitError) {
        console.warn(
          "Gagal mencatat kunjungan (mungkin duplikat):",
          visitError.message,
        );
      }
    }

    await connection.query("DELETE FROM tpenawaran_dtl WHERE pend_nomor = ?", [
      nomorPenawaran,
    ]);

    const stripEmojis = (str) => {
      if (typeof str !== "string" || !str) return str;
      return str.replace(/[\u{10000}-\u{10FFFF}]/gu, "");
    };

    for (const [index, item] of details.entries()) {
      const isCustom =
        item.sod_custom === "Y" || item.kode === "CUSTOM" || item.isCustomOrder;

      let displayUkuran = item.ukuran || "";
      let rawCustomData = null;

      if (isCustom && item.sod_custom_data) {
        try {
          const customData =
            typeof item.sod_custom_data === "string"
              ? JSON.parse(item.sod_custom_data)
              : item.sod_custom_data;

          if (customData.ukuranKaos && Array.isArray(customData.ukuranKaos)) {
            displayUkuran = [
              ...new Set(customData.ukuranKaos.map((u) => u.ukuran)),
            ].join(",");

            if (displayUkuran.length > 15) {
              displayUkuran = displayUkuran.substring(0, 15);
            }
          }

          rawCustomData = JSON.stringify(customData);
        } catch (e) {
          console.error("Gagal parse ukuran custom:", e);
          rawCustomData =
            typeof item.sod_custom_data === "string"
              ? item.sod_custom_data
              : JSON.stringify(item.sod_custom_data);
        }
      }

      const insertDetailQuery = `
        INSERT INTO tpenawaran_dtl
        (pend_idrec, pend_nomor, pend_kode, pend_ph_nomor, pend_sd_nomor, pend_ukuran, 
        pend_jumlah, pend_harga, pend_disc, pend_diskon, pend_nourut,
        pend_custom, pend_custom_nama, pend_custom_data, pend_is_free_gift)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await connection.query(insertDetailQuery, [
        idrec,
        nomorPenawaran,
        item.kode,
        item.noPengajuanHarga || "",
        item.noSoDtf || "",
        displayUkuran,
        item.jumlah,
        item.harga,
        item.diskonPersen || 0,
        item.diskonRp || 0,
        index + 1,
        isCustom ? "Y" : "N",
        isCustom ? stripEmojis(item.nama) : null,
        stripEmojis(rawCustomData),
        item.isFreeGift ? "Y" : "N",
      ]);
    }

    if (dps && dps.length > 0) {
      await connection.query(
        "DELETE FROM tpenawaran_dp WHERE pnd_nomor_pen = ?",
        [nomorPenawaran],
      );

      for (const dp of dps) {
        await connection.query(
          "INSERT INTO tpenawaran_dp (pnd_nomor_pen, pnd_nomor_dp) VALUES (?, ?)",
          [nomorPenawaran, dp.nomor],
        );

        await connection.query(
          "UPDATE tsetor_hdr SET sh_so_nomor = ? WHERE sh_nomor = ?",
          [nomorPenawaran, dp.nomor],
        );
      }
    }

    await connection.query(
      "DELETE FROM totorisasi WHERE o_nomor = ? AND o_transaksi = ?",
      [nomorPenawaran, nomorPenawaran],
    );

    const authNomorRef = header.nomorAuth || header.referensiAuth;
    if (authNomorRef && authNomorRef.includes("AUTH")) {
      await connection.query(
        `UPDATE totorisasi SET o_transaksi = ? WHERE o_nomor = ?`,
        [nomorPenawaran, authNomorRef],
      );
    }

    const processedBarcodes = new Set();
    for (const item of details) {
      if (item.pin && !processedBarcodes.has(item.barcode)) {
        const pinItemQuery =
          'INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_barcode, o_created, o_pin, o_nominal) VALUES (?, ?, "DISKON ITEM", ?, NOW(), ?, ?)';
        await connection.query(pinItemQuery, [
          nomorPenawaran,
          nomorPenawaran,
          item.barcode || "",
          item.pin,
          item.diskonPersen,
        ]);
        processedBarcodes.add(item.barcode);
      }
    }

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

const saveOfferDp = async (dpData, user) => {
  const {
    customerKode,
    tanggal,
    jenis,
    nominal,
    keterangan,
    bankData,
    giroData,
    nomorSo,
  } = dpData;

  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const cabang = user.cabang;

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

    const idrec = `${cabang}SH${format(new Date(), "yyyyMMddHHmmssSSS")}`;

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

  return rows[0];
};

const getDefaultDiscount = async (level, total, gudang) => {
  let discount = 0;
  const numericTotal = Number(total) || 0;

  if (numericTotal <= 0) {
    return { discount: 0 };
  }

  if (gudang === "KPR") {
    return { discount: 15 };
  }

  const query =
    "SELECT * FROM tcustomer_level WHERE level_kode = ? OR level_nama = ?";
  const [levelRows] = await pool.query(query, [level, level]);

  if (levelRows.length > 0) {
    const levelData = levelRows[0];

    const nominal1 = Number(levelData.level_nominal) || 0;
    const nominal2 = Number(levelData.level_nominal2) || 0;

    if (numericTotal >= nominal1) {
      discount = levelData.level_diskon;
    } else if (numericTotal >= nominal2) {
      discount = levelData.level_diskon2;
    } else {
      discount = 0;
    }
  }

  return { discount };
};

const getOfferForEdit = async (nomor) => {
  const connection = await pool.getConnection();
  try {
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
        g.gdg_kode, g.gdg_nama,
        h.user_create,
        u.user_nama
      FROM tpenawaran_hdr h
      LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
      LEFT JOIN tgudang g ON g.gdg_kode = h.pen_cab
      LEFT JOIN tuser u ON u.user_kode = h.user_create
      WHERE h.pen_nomor = ?;
    `;
    const [headerRows] = await connection.query(headerQuery, [nomor]);
    if (headerRows.length === 0) throw new Error("Penawaran tidak ditemukan.");

    const h = headerRows[0];

    const [soRows] = await connection.query(
      "SELECT so_nomor FROM tso_hdr WHERE so_pen_nomor = ? AND so_aktif = 'Y' LIMIT 1",
      [nomor],
    );
    const existingSoNomor = soRows.length > 0 ? soRows[0].so_nomor : null;

    const displayUser = h.user_nama
      ? `${h.user_create} - ${h.user_nama}`
      : h.user_create;

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
      jenisOrderKode: h.pen_jenis_order_kode,
      jenisOrderNama: h.pen_jenis_order_nama,
      namaDtf: h.pen_nama_dtf,
      nomorPromo: h.pen_promo_nomor,
      userCreate: displayUser,
      existingSoNomor,
    };

    const itemsQuery = `
      SELECT 
        d.pend_kode AS kode, IFNULL(b.brgd_barcode, "") AS barcode,
        IF(d.pend_custom = 'Y', d.pend_custom_nama, 
          IFNULL(
            NULLIF(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), ""),
            pbd.pbd_deskripsi
          )
        ) AS nama,
        d.pend_ukuran AS ukuran,
        IFNULL(stok.Stok, 0) as stok,
        d.pend_jumlah AS jumlah, d.pend_harga AS harga,
        d.pend_disc AS diskonPersen, d.pend_diskon AS diskonRp,
        (d.pend_jumlah * (d.pend_harga - d.pend_diskon)) as total,
        d.pend_ph_nomor as noPengajuanHarga,
        d.pend_sd_nomor as noSoDtf,
        d.pend_custom, d.pend_custom_nama, d.pend_custom_data,
        d.pend_is_free_gift AS isFreeGift,
        IFNULL(a.brg_ktgp, '') AS kategori
      FROM tpenawaran_dtl d
      LEFT JOIN tbarangdc a ON a.brg_kode = d.pend_kode
      LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.pend_kode AND b.brgd_ukuran = d.pend_ukuran
      LEFT JOIN tpengajuanharga_barang_draft pbd ON pbd.pbd_kode_barang_draft = d.pend_kode
      LEFT JOIN (
        SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in - mst_stok_out) AS Stok 
        FROM tmasterstok WHERE mst_aktif = "Y" AND mst_cab = ? GROUP BY mst_brg_kode, mst_ukuran
      ) stok ON stok.mst_brg_kode = d.pend_kode AND stok.mst_ukuran = d.pend_ukuran
      WHERE d.pend_nomor = ? ORDER BY d.pend_nourut;
    `;
    const [itemsData] = await connection.query(itemsQuery, [h.gdg_kode, nomor]);

    const dpQuery = `
      SELECT sk.sh_nomor AS nomor, 
             DATE_FORMAT(sk.sh_tanggal, '%d-%m-%Y') AS tanggal,
             IF(sk.sh_jenis=0, 'TUNAI', IF(sk.sh_jenis=1, 'TRANSFER', 'GIRO')) AS jenis,
             sk.sh_nominal AS nominal, 'BELUM' as posting, '' as fsk
      FROM tpenawaran_dp link
      JOIN tsetor_hdr sk ON sk.sh_nomor = link.pnd_nomor_dp
      WHERE link.pnd_nomor_pen = ?
    `;
    const [dpItemsData] = await connection.query(dpQuery, [nomor]);

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
 * @description Mencari Pengajuan Harga yang bisa ditarik ke Penawaran.
 * [DIUBAH] Sebelumnya filter `ph_apv <> ""` (baru keisi saat Acc Finance),
 * tapi tahap approval itu belum diimplementasikan — jadi selama ini nggak ada
 * satupun yang bisa ketarik. Sesuai lampiran flow (No.3-4), Penawaran memang
 * ditarik dari Pengajuan Harga yang MASIH DRAFT, sebelum approval customer/
 * finance. Filter diganti ke ph_status.
 *
 * `allowedStatuses` dibuat parameter (bukan hardcode) supaya gampang diperluas
 * nanti kalau status lanjutan (ACC_CUSTOMER, dst) juga boleh ditarik.
 */
const searchApprovedPriceProposals = async (params) => {
  const { cabang, customerKode, term, statuses, onlyCustom } = params;
  const searchTerm = `%${term}%`;

  // [DIUBAH] Default sekarang termasuk ACC_CUSTOMER selain DRAFT — Pengajuan
  // Harga yang sudah di-ACC Customer juga boleh ditarik ke Penawaran, sesuai
  // update flow (sebelumnya cuma DRAFT yang boleh).
  let allowedStatuses = statuses
    ? statuses.split(",")
    : ["DRAFT", "ACC_CUSTOMER"];

  // [FIX] Data lama (dibuat sebelum kolom ph_status ada): ph_status tetap
  // 'DRAFT' di DB walau sudah pernah di-approve (ph_apv terisi). Kalau SO
  // minta ACC_FINANCE, sertakan juga kandidat legacy ini.
  if (allowedStatuses.includes("ACC_FINANCE")) {
    allowedStatuses = [...allowedStatuses, "LEGACY_APPROVED"];
  }

  const statusPlaceholders = allowedStatuses.map(() => "?").join(", ");
  const customFilter = onlyCustom === "Y" ? "AND h.ph_custom = 'Y'" : "";

  const query = `
        SELECT 
            h.ph_nomor AS nomor,
            h.ph_tanggal AS tanggal,
            c.cus_nama AS customer,
            h.ph_jenis AS jenisKaos,
            h.ph_ket AS keterangan,
            -- [FIX] Status ternormalisasi — sama logic dengan browse, supaya
            -- data legacy approved match saat dicari filter ACC_FINANCE.
            CASE 
              WHEN (h.ph_status IS NULL OR h.ph_status = 'DRAFT')
                AND h.ph_apv IS NOT NULL AND h.ph_apv <> ''
              THEN 'LEGACY_APPROVED'
              ELSE IFNULL(h.ph_status, 'DRAFT')
            END AS status,
            h.ph_custom AS isCustom,
            h.ph_kode_barang_draft AS kodeBarangDraft
        FROM tpengajuanharga h
        LEFT JOIN tcustomer c ON c.cus_kode = h.ph_kd_cus
        WHERE h.ph_kd_cus = ?
          AND (
            CASE 
              WHEN (h.ph_status IS NULL OR h.ph_status = 'DRAFT')
                AND h.ph_apv IS NOT NULL AND h.ph_apv <> ''
              THEN 'LEGACY_APPROVED'
              ELSE IFNULL(h.ph_status, 'DRAFT')
            END
          ) IN (${statusPlaceholders})
          AND h.ph_cab = ?
          ${customFilter}
          AND (h.ph_nomor LIKE ? OR h.ph_ket LIKE ?)
        ORDER BY h.ph_nomor DESC
    `;
  const [rows] = await pool.query(query, [
    customerKode,
    ...allowedStatuses,
    cabang,
    searchTerm,
    searchTerm,
  ]);
  return rows;
};

/**
 * @description Mengambil semua detail dari Pengajuan Harga untuk diimpor.
 * [DIUBAH] Tambah fallback nama untuk item Custom yang kode barangnya masih
 * Draft (belum ada di tbarangdc sampai Acc Finance) — pakai deskripsi hasil
 * generate dari tpengajuanharga_barang_draft.
 */
const getPriceProposalDetailsForSo = async (nomor) => {
  const cabang = nomor ? nomor.substring(0, 3) : "";

  const [headerRows] = await pool.query(
    "SELECT *, ph_nomor AS nomor FROM tpengajuanharga WHERE ph_nomor = ?",
    [nomor],
  );
  if (headerRows.length === 0)
    throw new Error("Data Pengajuan Harga tidak ditemukan.");

  const detailQuery = `
        SELECT 
            d.phs_kode AS kode,
            b.brgd_barcode as barcode,
            IFNULL(
              NULLIF(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), ""),
              pbd.pbd_deskripsi
            ) AS nama,
            d.phs_size AS ukuran,
            d.phs_jumlah AS jumlah,
            (d.phs_harga + IFNULL(t.tambahan, 0) + IFNULL(brd.bordir, 0) + IFNULL(dt.dtf, 0)) AS harga,
            (d.phs_jumlah * (d.phs_harga + IFNULL(t.tambahan, 0) + IFNULL(brd.bordir, 0) + IFNULL(dt.dtf, 0))) as total,
            IFNULL(stok.Stok, 0) as stok,
            IFNULL(a.brg_ktgp, '') AS kategori
        FROM tpengajuanharga_size d
        LEFT JOIN tpengajuanharga h ON h.ph_nomor = d.phs_nomor
        LEFT JOIN tbarangdc a ON a.brg_kode = d.phs_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.phs_kode AND b.brgd_ukuran = d.phs_size
        LEFT JOIN tpengajuanharga_barang_draft pbd ON pbd.pbd_nomor = d.phs_nomor AND pbd.pbd_kode_barang_draft = d.phs_kode
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

  const [detailRows] = await pool.query(detailQuery, [cabang, nomor]);

  return { headerData: headerRows[0], itemsData: detailRows };
};

const getDataForPrint = async (nomor) => {
  const connection = await pool.getConnection();
  try {
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

    const [gudangRows] = await connection.query(
      `SELECT gdg_inv_nama, gdg_inv_alamat, gdg_inv_kota, gdg_inv_telp, gdg_akun, gdg_transferbank 
       FROM tgudang WHERE gdg_kode = ?`,
      [header.pen_cab],
    );
    const gudang = gudangRows[0];

    const [rawDetails] = await connection.query(
      `
        SELECT 
            d.pend_kode AS kode, 
            CASE 
                WHEN d.pend_custom = 'Y' AND NULLIF(d.pend_custom_nama, '') IS NOT NULL 
                    THEN d.pend_custom_nama 
                WHEN f.sd_nama IS NOT NULL 
                    THEN f.sd_nama
                ELSE IFNULL(
                    NULLIF(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), ""),
                    IFNULL(pbd.pbd_deskripsi, "Jasa Cetak")
                )
            END AS nama_barang,
            d.pend_ukuran AS ukuran, d.pend_jumlah AS qty, d.pend_harga AS harga,
            d.pend_diskon AS diskon, (d.pend_jumlah * (d.pend_harga - d.pend_diskon)) as total
        FROM tpenawaran_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.pend_kode
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.pend_sd_nomor
        LEFT JOIN tpengajuanharga_barang_draft pbd ON pbd.pbd_kode_barang_draft = d.pend_kode
        WHERE d.pend_nomor = ? 
        ORDER BY d.pend_nourut
    `,
      [nomor],
    );

    const details = rawDetails.map((item) => {
      let displayUkuran = item.ukuran;

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
            IFNULL(h.brg_ktgp, '') AS kategori,
            
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

  const [rows] = await pool.query(query, [gudang, barcode]);

  if (rows.length === 0) {
    throw new Error("Barcode tidak ditemukan atau barang tidak aktif.");
  }
  return rows[0];
};

/**
 * Rename file bukti ulasan Google Maps (promo wajib review) dari lokasi
 * temp multer ke folder permanen, dinamai sesuai nomor Penawaran — sama
 * pola dengan renameProposalImage di priceProposalFormService.
 */
const renameReviewProofImage = async (tempFilePath, nomor) => {
  return new Promise((resolve, reject) => {
    const fs = require("fs");
    const path = require("path");
    if (!fs.existsSync(tempFilePath)) {
      console.error("Source file does not exist:", tempFilePath);
      return reject(new Error("File sumber tidak ditemukan."));
    }
    const finalFileName = `${nomor}${path.extname(tempFilePath)}`;
    const folderPath = path.join(
      process.cwd(),
      "public",
      "images",
      "review-proof",
    );
    try {
      fs.mkdirSync(folderPath, { recursive: true });
    } catch (mkdirError) {
      console.error("Error creating directory:", mkdirError);
      return reject(new Error("Gagal membuat direktori bukti ulasan."));
    }
    const finalPath = path.join(folderPath, finalFileName);
    fs.rename(tempFilePath, finalPath, (err) => {
      if (err) {
        fs.copyFile(tempFilePath, finalPath, (copyErr) => {
          if (copyErr) {
            console.error("Gagal copy file:", copyErr);
            return reject(
              new Error("Gagal memproses file bukti: " + copyErr.message),
            );
          }
          fs.unlink(tempFilePath, () => {});
          resolve(finalPath);
        });
      } else {
        resolve(finalPath);
      }
    });
  });
};

// ===== PENAWARAN ONLINE (katalog publik, tanpa login) =====
// Semua input dari internet dianggap tidak tepercaya: tipe dicek ketat (string/number murni),
// teks dibersihkan, dan hanya field yang dikenal yang diteruskan.

const ONLINE_LIMIT = { ITEMS: 50, QTY: 99, CUSTOM: 10, TITIK: 10, DIM_CM: 500 };

// Error yang aman ditampilkan ke pengunjung. Error lain jangan pernah dibocorkan.
class OnlineOfferError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "OnlineOfferError";
    this.status = status;
  }
}

const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const bersihTeks = (v, maks) => {
  if (typeof v !== "string") return "";
  return v
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // é -> e
    .replace(/[^\x20-\x7E]/g, " ") // emoji, karakter kontrol, non-ASCII (tabel latin1)
    .replace(/[<>`\\]/g, "") // cegah markup tersimpan lalu tampil di ERP/cetak
    .replace(/\s+/g, " ")
    .replace(/^[=+\-@\s]+/, "") // cegah formula Excel saat staf ekspor
    .trim()
    .slice(0, maks)
    .trim();
};

const normalizeOnlineOfferInput = (body) => {
  if (!isPlainObject(body)) {
    throw new OnlineOfferError("Data yang dikirim tidak valid.");
  }

  const cabang =
    typeof body.cabang === "string" ? body.cabang.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{3}$/.test(cabang)) {
    throw new OnlineOfferError("Store tujuan tidak valid.");
  }

  // --- customer
  const c = isPlainObject(body.customer) ? body.customer : {};
  const nama = bersihTeks(c.nama, 50);
  if (nama.length < 2 || !/[A-Za-z]/.test(nama)) {
    throw new OnlineOfferError("Nama minimal 2 huruf.");
  }
  const telp = normalizeTelp(typeof c.telp === "string" ? c.telp : "");
  if (!telp) {
    throw new OnlineOfferError("Nomor HP tidak valid. Contoh: 081234567890.");
  }
  const alamat = bersihTeks(c.alamat, 200);
  if (alamat.length < 8) {
    throw new OnlineOfferError("Alamat terlalu pendek.");
  }

  // --- barang biasa
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new OnlineOfferError("Keranjang masih kosong.");
  }
  if (body.items.length > ONLINE_LIMIT.ITEMS) {
    throw new OnlineOfferError(
      `Maksimal ${ONLINE_LIMIT.ITEMS} item per penawaran.`,
    );
  }
  const itemMap = new Map();
  for (const it of body.items) {
    if (!isPlainObject(it)) {
      throw new OnlineOfferError("Ada item yang tidak valid.");
    }
    const kode = typeof it.kode === "string" ? it.kode.trim() : "";
    const ukuran = typeof it.ukuran === "string" ? it.ukuran.trim() : "";
    if (
      !/^[A-Za-z0-9._-]{1,20}$/.test(kode) ||
      !/^[A-Za-z0-9./ -]{1,15}$/.test(ukuran)
    ) {
      throw new OnlineOfferError("Ada item yang tidak valid.");
    }
    if (!Number.isInteger(it.qty) || it.qty < 1) {
      throw new OnlineOfferError("Jumlah item tidak valid.");
    }
    const key = `${kode}|${ukuran}`.toUpperCase();
    const qty = (itemMap.has(key) ? itemMap.get(key).qty : 0) + it.qty;
    if (qty > ONLINE_LIMIT.QTY) {
      throw new OnlineOfferError(
        `Jumlah per item maksimal ${ONLINE_LIMIT.QTY}.`,
      );
    }
    itemMap.set(key, { kode, ukuran, qty });
  }
  const items = [...itemMap.values()];
  const kodeKanon = new Map(items.map((i) => [i.kode.toUpperCase(), i.kode]));

  // --- jasa custom (opsional). Satu penawaran = satu jenis; wajib dipasangkan ke kaos di keranjang.
  const customRaw = body.custom === undefined ? [] : body.custom;
  if (!Array.isArray(customRaw) || customRaw.length > ONLINE_LIMIT.CUSTOM) {
    throw new OnlineOfferError("Jasa custom tidak valid.");
  }

  let jenisOrder = null;
  const custom = [];
  for (const cu of customRaw) {
    if (!isPlainObject(cu)) {
      throw new OnlineOfferError("Jasa custom tidak valid.");
    }
    const jasa =
      typeof cu.jenis === "string"
        ? getJasa(cu.jenis.trim().toUpperCase())
        : null;
    if (!jasa) throw new OnlineOfferError("Jenis jasa custom tidak dikenal.");
    if (jenisOrder && jenisOrder !== jasa.kode) {
      throw new OnlineOfferError(
        "Satu penawaran hanya untuk satu jenis jasa custom. Kirim jenis lain sebagai penawaran terpisah.",
      );
    }
    jenisOrder = jasa.kode;

    // Ukuran cetak + warna kaos hanya relevan untuk jasa berbasis ukuran (SB, TG)
    let ukuranCetak = null;
    let warna = null;
    if (jasa.mode === "ukuran") {
      ukuranCetak = UKURAN_CETAK.includes(cu.ukuranCetak)
        ? cu.ukuranCetak
        : null;
      if (!ukuranCetak) throw new OnlineOfferError("Ukuran cetak tidak valid.");
      warna = jasa.bedaWarnaKaos
        ? WARNA_KAOS.includes(cu.warna)
          ? cu.warna
          : null
        : "WARNA";
      if (!warna) throw new OnlineOfferError("Warna kaos tidak valid.");
    }

    if (
      !Array.isArray(cu.titiks) ||
      cu.titiks.length < 1 ||
      cu.titiks.length > ONLINE_LIMIT.TITIK
    ) {
      throw new OnlineOfferError("Titik cetak tidak valid.");
    }
    const titiks = cu.titiks.map((t, i) => {
      if (!isPlainObject(t))
        throw new OnlineOfferError("Titik cetak tidak valid.");
      const namaTitik = bersihTeks(t.nama, 30) || `Titik ${i + 1}`;
      let panjang = 0;
      let lebar = 0;
      if (jasa.mode === "luas") {
        const dimOk = (n) =>
          typeof n === "number" &&
          Number.isFinite(n) &&
          n >= 1 &&
          n <= ONLINE_LIMIT.DIM_CM;
        if (!dimOk(t.panjang) || !dimOk(t.lebar)) {
          throw new OnlineOfferError(
            `Ukuran titik "${namaTitik}" harus 1-${ONLINE_LIMIT.DIM_CM} cm.`,
          );
        }
        panjang = Math.round(t.panjang * 100) / 100;
        lebar = Math.round(t.lebar * 100) / 100;
      }
      return { nama: namaTitik, panjang, lebar };
    });

    if (
      !Array.isArray(cu.kaos) ||
      cu.kaos.length < 1 ||
      cu.kaos.length > ONLINE_LIMIT.ITEMS
    ) {
      throw new OnlineOfferError("Pilih kaos yang akan diberi jasa custom.");
    }
    const kaos = [
      ...new Set(
        cu.kaos.map((k) => {
          const kanon =
            typeof k === "string"
              ? kodeKanon.get(k.trim().toUpperCase())
              : null;
          if (!kanon) {
            throw new OnlineOfferError(
              "Kaos untuk jasa custom tidak ada di keranjang.",
            );
          }
          return kanon;
        }),
      ),
    ];

    custom.push({
      jenis: jasa.kode,
      nama: bersihTeks(cu.nama, 60),
      ukuranCetak,
      warna,
      titiks,
      kaos,
    });
  }

  return {
    cabang,
    customer: { nama, telp, alamat },
    items,
    custom,
    jenisOrder,
  };
};

// ===== PENAWARAN ONLINE: harga, stok, simpan =====

const BERLAKU_HARI = 3;
const MAKS_PERCOBA = 3;
// Dimensi cetak per ukuran kertas (cm), sama dengan data lama: A3 42x29.7, A4 29.7x21
const UKURAN_CM = { A3: [42, 29.7], A4: [29.7, 21], A5: [21, 14.8] };

const waktuWib = () => new Date(Date.now() + 7 * 60 * 60 * 1000);
const tglIso = (d) => d.toISOString().slice(0, 10);
const tglIndo = (iso) =>
  `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

const daftarSingkat = (arr) =>
  arr.length > 5
    ? `${arr.slice(0, 5).join(", ")}, dan ${arr.length - 5} lainnya`
    : arr.join(", ");

/**
 * Hanya membaca & menghitung (tanpa menulis). Harga, promo, dan stok SELALU dari server;
 * apa pun yang dikirim klien selain kode/ukuran/qty/titik diabaikan.
 */
const buildOnlineOffer = async (input) => {
  const { cabang } = input;

  const stores = await getPublicStores();
  if (
    PAMERAN_BRANCHES.includes(cabang) ||
    !stores.some((s) => s.kode === cabang)
  ) {
    throw new OnlineOfferError("Store tujuan tidak tersedia.");
  }

  const [stokRows, promoMap] = await Promise.all([
    getPublicStockLive(cabang, ""),
    getPromoDiskonMap(cabang),
  ]);
  const stokMap = new Map(stokRows.map((r) => [promoKey(r.kode, r.ukuran), r]));

  // --- barang biasa
  const tidakAda = [];
  const stokKurang = [];
  const regular = [];
  for (const it of input.items) {
    const key = promoKey(it.kode, it.ukuran);
    const row = stokMap.get(key);
    const harga = row ? Number(row.harga) : 0;
    if (!row || !(harga > 0)) {
      tidakAda.push(`${it.kode} ${it.ukuran}`);
      continue;
    }
    // Penawaran tidak menahan stok: kurang tetap disimpan, hanya dilaporkan.
    const stok = Number(row.stok) || 0;
    if (stok < it.qty) {
      stokKurang.push({
        nama: row.nama,
        ukuran: String(row.ukuran).trim(),
        diminta: it.qty,
        tersisa: Math.max(stok, 0),
      });
    }
    const disc = promoMap.get(key);
    const diskonRp = harga - hargaSetelahPromo(harga, disc);
    regular.push({
      inKode: it.kode, // kode seperti di input, untuk mencocokkan custom.kaos
      kode: String(row.kode).trim(),
      nama: row.nama,
      ukuran: String(row.ukuran).trim(),
      qty: it.qty,
      harga,
      diskonRp,
      diskonPersen: diskonRp > 0 ? disc.persen : 0,
      promoNomor: diskonRp > 0 ? disc.nomor : null,
      promoUnik: diskonRp > 0 ? disc.nPromo === 1 : true,
    });
  }
  if (tidakAda.length) {
    throw new OnlineOfferError(
      `Barang tidak tersedia di store ini: ${daftarSingkat(tidakAda)}.`,
      409,
    );
  }

  // --- promo header (pilihan A): diisi hanya bila semua baris berpromo satu nomor yang sama
  const dipromo = regular.filter((l) => l.diskonRp > 0);
  const nomorSet = new Set(dipromo.map((l) => l.promoNomor));
  const promoNomor =
    dipromo.length > 0 &&
    nomorSet.size === 1 &&
    dipromo.every((l) => l.promoUnik)
      ? [...nomorSet][0] || null
      : null;

  // --- jasa custom: satu baris per ukuran kaos, harga dari total pcs kaos terpilih
  const custom = [];
  for (const cu of input.custom) {
    const jasa = getJasa(cu.jenis);
    const picked = regular.filter((l) => cu.kaos.includes(l.inKode));
    const totalPcs = picked.reduce((s, l) => s + l.qty, 0);

    let est;
    try {
      // ukuran/warna hanya dipakai jasa berbasis ukuran; untuk jasa luas diisi nilai aman
      est = hitungEstimasi(
        jasa,
        totalPcs,
        cu.ukuranCetak || "A4",
        cu.warna || "WARNA",
        cu.titiks,
      );
    } catch (e) {
      throw new OnlineOfferError("Ukuran titik cetak tidak valid.");
    }
    const satuan = Math.round(est.satuan);
    if (!(satuan > 0)) {
      throw new OnlineOfferError("Harga jasa custom tidak valid.");
    }

    const label = labelSizeCetak(jasa, cu.ukuranCetak, cu.warna);
    const titikCetak = cu.titiks.map((t) => {
      const [p, l] =
        jasa.mode === "ukuran"
          ? UKURAN_CM[cu.ukuranCetak]
          : [t.panjang, t.lebar];
      return {
        keterangan: t.nama,
        sizeCetak: label,
        warna: "",
        panjang: p,
        lebar: l,
      };
    });
    const sourceItems = [
      ...picked.map((l) => ({
        kode: l.kode,
        nama: l.nama,
        ukuran: l.ukuran,
        jumlah: l.qty,
      })),
      { kode: "", nama: "", ukuran: "", jumlah: 0 }, // baris penutup, sama dengan data lama
    ];
    const hargaPerCm = jasa.mode === "luas" ? est.hargaPerCm2 : 0;
    const namaDesain = (cu.nama || `${jasa.nama} ${picked[0].nama}`).slice(
      0,
      100,
    );

    const perUkuran = new Map();
    for (const l of picked) {
      perUkuran.set(l.ukuran, (perUkuran.get(l.ukuran) || 0) + l.qty);
    }
    for (const [ukuran, jumlah] of perUkuran) {
      custom.push({
        nama: namaDesain,
        ukuran,
        jumlah,
        harga: satuan,
        data: JSON.stringify({
          ukuranKaos: [{ ukuran, jumlah, harga: satuan }],
          titikCetak,
          hargaPerCm,
          sourceItems,
        }),
      });
    }
  }

  const total =
    regular.reduce((s, l) => s + l.qty * (l.harga - l.diskonRp), 0) +
    custom.reduce((s, c) => s + c.jumlah * c.harga, 0);

  return {
    cabang,
    jenisOrderKode: input.jenisOrder,
    jenisOrderNama: input.jenisOrder
      ? getJasa(input.jenisOrder).nama.toUpperCase()
      : null,
    promoNomor,
    stokKurang,
    regular,
    custom,
    total,
  };
};

/**
 * Simpan penawaran dari katalog publik. Satu transaksi: customer (cari/buat) + header + detail.
 * ER_DUP_ENTRY (nomor penawaran / kode customer bentrok dengan transaksi lain) -> coba ulang.
 * Error selain OnlineOfferError JANGAN diteruskan ke klien (controller yang membungkus).
 */
const saveOnlineOffer = async (body) => {
  const input = normalizeOnlineOfferInput(body);
  const plan = await buildOnlineOffer(input);

  const wib = waktuWib();
  const tanggal = tglIso(wib);
  const berlaku = tglIndo(
    tglIso(new Date(wib.getTime() + BERLAKU_HARI * 24 * 60 * 60 * 1000)),
  );
  const keterangan = `KATALOG ONLINE - BERLAKU S/D ${berlaku}`;

  for (let percobaan = 1; percobaan <= MAKS_PERCOBA; percobaan++) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const customer = await findOrCreateOnlineCustomer(connection, {
        nama: input.customer.nama,
        alamat: input.customer.alamat,
        telp: input.customer.telp,
        cabang: input.cabang,
      });

      const nomor = await generateNewOfferNumber(
        connection,
        input.cabang,
        tanggal,
      );
      const idrec = `${input.cabang}PEN${format(new Date(), "yyyyMMddHHmmssSSS")}`;

      await connection.query(
        `INSERT INTO tpenawaran_hdr
         (pen_idrec, pen_nomor, pen_tanggal, pen_top, pen_ppn, pen_disc, pen_disc1, pen_disc2,
          pen_bkrm, pen_cus_kode, pen_cus_level, pen_ket, pen_cab, user_create, date_create,
          pen_jenis_order_kode, pen_jenis_order_nama, pen_nama_dtf, pen_promo_nomor)
         VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, 'ONLINE', NOW(), ?, ?, NULL, ?)`,
        [
          idrec,
          nomor,
          tanggal,
          customer.kode,
          Number(customer.level) || 5,
          keterangan,
          input.cabang,
          plan.jenisOrderKode,
          plan.jenisOrderNama,
          plan.promoNomor,
        ],
      );

      let urut = 0;
      const rows = [
        ...plan.regular.map((l) => [
          idrec,
          nomor,
          l.kode,
          "",
          "",
          l.ukuran,
          l.qty,
          l.harga,
          l.diskonPersen,
          l.diskonRp,
          ++urut,
          "N",
          null,
          null,
          "N",
        ]),
        ...plan.custom.map((c) => [
          idrec,
          nomor,
          "CUSTOM",
          "",
          "",
          c.ukuran,
          c.jumlah,
          c.harga,
          0,
          0,
          ++urut,
          "Y",
          c.nama,
          c.data,
          "N",
        ]),
      ];
      await connection.query(
        `INSERT INTO tpenawaran_dtl
         (pend_idrec, pend_nomor, pend_kode, pend_ph_nomor, pend_sd_nomor, pend_ukuran,
          pend_jumlah, pend_harga, pend_disc, pend_diskon, pend_nourut,
          pend_custom, pend_custom_nama, pend_custom_data, pend_is_free_gift)
         VALUES ?`,
        [rows],
      );

      await connection.commit();
      // Sengaja tidak mengembalikan apakah customer baru atau lama.
      return {
        nomor,
        tanggal,
        berlakuSampai: berlaku,
        total: plan.total,
        stokKurang: plan.stokKurang,
      };
    } catch (err) {
      try {
        await connection.rollback();
      } catch (_) {
        /* koneksi sudah putus; release di finally */
      }
      if (err && err.code === "ER_DUP_ENTRY") {
        if (percobaan < MAKS_PERCOBA) continue;
        throw new OnlineOfferError(
          "Server sedang sibuk, coba kirim lagi sebentar lagi.",
          503,
        );
      }
      throw err;
    } finally {
      connection.release();
    }
  }
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
  renameReviewProofImage,
  OnlineOfferError,
  normalizeOnlineOfferInput,
  bersihTeks,
  buildOnlineOffer,
  saveOnlineOffer,
};
