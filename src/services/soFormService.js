const pool = require("../config/database");
const { format } = require("date-fns");
const { get } = require("../routes/salesCounterRoute");

/**
 * @description Membuat nomor SO baru (getmaxnomor).
 */
const generateNewSoNumber = async (connection, cabang, tanggal) => {
  const datePrefix = format(new Date(tanggal), "yyMM");
  const prefix = `${cabang}.SO.${datePrefix}`;
  const [rows] = await connection.query(
    `SELECT IFNULL(MAX(CAST(RIGHT(so_nomor, 4) AS UNSIGNED)), 0) AS maxNum
     FROM tso_hdr
     WHERE so_cab = ?
     AND so_nomor LIKE CONCAT(?, '%')`,
    [cabang, prefix] // cabang = "K07", prefix = "K07.SO.2511"
  );
  const nextNum = parseInt(rows[0].maxNum, 10) + 1;
  return `${prefix}.${String(10000 + nextNum).slice(1)}`;
};

/**
 * @description Menyimpan data SO (simpandata).
 */
const save = async (data, user) => {
  const { header, footer, details, dps, isNew } = data;
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    let soNomor = header.nomor;
    let idrec;
    const aktifStatus = header.statusSo === "AKTIF" ? "Y" : "N";

    // 1. Tentukan nomor & simpan/update data Header
    if (isNew) {
      soNomor = await generateNewSoNumber(
        connection,
        header.gudang.kode,
        header.tanggal
      );
      idrec = `${header.gudang.kode}SO${format(
        new Date(),
        "yyyyMMddHHmmssSSS"
      )}`;

      const insertHeaderQuery = `
          INSERT INTO tso_hdr (
            so_idrec, so_nomor, so_tanggal, so_dateline, so_pen_nomor, so_top, so_ppn,
            so_disc, so_disc1, so_disc2, so_bkrm, so_dp, so_cus_kode, so_cus_level,
            so_accdp, so_ket, so_aktif, so_sc, so_jenisorder, so_namadtf, so_cab, user_create, date_create
           )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;
      await connection.query(insertHeaderQuery, [
        idrec,
        soNomor,
        header.tanggal,
        header.dateline,
        header.penawaran,
        header.top || 0,
        header.ppnPersen || 0,
        footer.diskonRp,
        footer.diskonPersen1,
        footer.diskonPersen2,
        footer.biayaKirim,
        footer.totalDp,
        header.customer.kode,
        header.level,
        footer.pinTanpaDp,
        header.keterangan,
        aktifStatus,
        header.salesCounter,
        header.jenisOrderKode ? String(header.jenisOrderKode) : null,
        header.namaDtf ? String(header.namaDtf) : null,
        header.gudang.kode,
        user.kode,
      ]);
    } else {
      const [idrecRows] = await connection.query(
        "SELECT so_idrec FROM tso_hdr WHERE so_nomor = ?",
        [soNomor]
      );
      if (idrecRows.length === 0)
        throw new Error("Nomor SO untuk diupdate tidak ditemukan.");
      idrec = idrecRows[0].so_idrec;

      const updateHeaderQuery = `
        UPDATE tso_hdr SET
          so_cus_kode = ?, so_pen_nomor = ?, so_cus_level = ?, so_tanggal = ?, 
          so_dateline = ?, so_top = ?, so_ppn = ?, so_accdp = ?, so_ket = ?,
          so_jenisorder = ?, so_namadtf = ?,
          so_disc = ?, so_disc1 = ?, so_disc2 = ?, so_bkrm = ?, so_dp = ?, 
          so_aktif = ?, so_sc = ?, user_modified = ?, date_modified = NOW()
        WHERE so_nomor = ?
      `;
      await connection.query(updateHeaderQuery, [
        header.customer.kode,
        header.penawaran,
        header.level,
        header.tanggal,
        header.dateline,
        header.top || 0,
        header.ppnPersen || 0,
        footer.pinTanpaDp,
        header.keterangan,
        header.jenisOrderKode || header.jenisOrder || null,
        header.namaDtf || null,
        footer.diskonRp,
        footer.diskonPersen1,
        footer.diskonPersen2,
        footer.biayaKirim,
        footer.totalDp,
        aktifStatus,
        header.salesCounter,
        user.kode,
        soNomor,
      ]);
    }

    // 2. Hapus detail lama dan sisipkan yang baru
    await connection.query("DELETE FROM tso_dtl WHERE sod_so_nomor = ?", [
      soNomor,
    ]);
    for (const [index, item] of details.entries()) {
      const kodeBarang = item.kode || (item.isCustomOrder ? "CUSTOM" : "");
      const isCustom = item.isCustomOrder ? "Y" : "N";

      let customData = null;

      if (item.isCustomOrder) {
        if (item.sod_custom_data) {
          // Kalau frontend sudah kirim sod_custom_data,
          // pakai itu saja, jangan dibikin ulang
          customData =
            typeof item.sod_custom_data === "string"
              ? item.sod_custom_data
              : JSON.stringify(item.sod_custom_data);
        } else {
          // Fallback: kalau memang belum ada, baru rakit dari field lain
          customData = JSON.stringify({
            ukuranKaos: item.ukuranKaos || [],
            titikCetak: item.titikCetak || [],
            sourceItems: item.sourceItems || [],
          });
        }
      }

      await connection.query(
        `INSERT INTO tso_dtl 
        (sod_idrec, sod_so_nomor, sod_kode, sod_ph_nomor, sod_sd_nomor, sod_ukuran, sod_jumlah, sod_harga, sod_disc, sod_diskon, sod_nourut, sod_custom, sod_custom_nama, sod_custom_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          idrec,
          soNomor,
          kodeBarang,
          item.noPengajuanHarga || "",
          item.noSoDtf || "",
          item.ukuran || "",
          item.jumlah || 0,
          item.harga || 0,
          item.diskonPersen || 0,
          item.diskonRp || 0,
          index + 1,
          isCustom,
          isCustom === "Y" ? item.sod_custom_nama : null,
          customData,
        ]
      );
    }

    // 3. Simpan PIN Otorisasi (logika simpanpin)
    for (const item of details) {
      if (item.pin) {
        await connection.query(
          'INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_barcode, o_created, o_pin, o_nominal) VALUES (?, "SO", "DISKON ITEM", ?, NOW(), ?, ?)',
          [soNomor, item.barcode || "", item.pin, item.diskonPersen]
        );
      }
    }
    if (footer.pinDiskon1) {
      await connection.query(
        'INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_created, o_pin, o_nominal) VALUES (?, "SO", "DISKON FAKTUR", NOW(), ?, ?)',
        [soNomor, footer.pinDiskon1, footer.diskonPersen1]
      );
    }
    if (footer.pinDiskon2) {
      await connection.query(
        'INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_created, o_pin, o_nominal) VALUES (?, "SO", "DISKON FAKTUR 2", NOW(), ?, ?)',
        [soNomor, footer.pinDiskon2, footer.diskonPersen2]
      );
    }
    if (footer.pinTanpaDp) {
      await connection.query(
        'INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_created, o_pin, o_nominal) VALUES (?, "SO", "TANPA DP", NOW(), ?, ?)',
        [soNomor, footer.pinTanpaDp, footer.belumDibayar]
      );
    }

    // 4. Update nomor SO di setoran (logika simpannoso)
    if (dps && dps.length > 0) {
      const noSetoran = dps.map((dp) => dp.nomor);
      await connection.query(
        "UPDATE tsetor_hdr SET sh_so_nomor = ? WHERE sh_nomor IN (?)",
        [soNomor, noSetoran]
      );
    }

    await connection.query(
      `UPDATE tsetor_hdr
       SET sh_so_nomor = ?
       WHERE sh_cus_kode = ?
        AND (sh_so_nomor = '' OR sh_so_nomor IS NULL)`,
      [soNomor, header.customer.kode]
    );

    await connection.commit();
    return {
      message: `Surat Pesanan ${soNomor} berhasil disimpan.`,
      nomor: soNomor,
    };
  } catch (error) {
    await connection.rollback();
    console.error("Save SO Error:", error);
    throw new Error("Gagal menyimpan Surat Pesanan.");
  } finally {
    connection.release();
  }
};

/**
 * @description Memuat semua data untuk mode Ubah (loaddataall).
 */
const getSoForEdit = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    const [invoiceRows] = await connection.query(
      "SELECT inv_nomor FROM tinv_hdr WHERE inv_nomor_so = ?",
      [nomor]
    );
    const isInvoiced = invoiceRows.length > 0;

    // 2. Ambil data Header Utama & Detail Item dalam satu query
    const mainQuery = `
  SELECT 
      h.*, d.*, 
      c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp,
      DATE_FORMAT(c.cus_tgllahir, '%d-%m-%Y') AS tgllahir,
      b.brgd_barcode,
      l.level_nama,
      g.gdg_kode,
      g.gdg_nama,
      CONCAT(h.so_cus_level, ' - ', l.level_nama) AS xLevel,
      IFNULL(
        TRIM(CONCAT(
          COALESCE(a.brg_jeniskaos, ''), ' ',
          COALESCE(a.brg_tipe, ''), ' ',
          COALESCE(a.brg_lengan, ''), ' ',
          COALESCE(a.brg_jeniskain, ''), ' ',
          COALESCE(a.brg_warna, '')
        )),
        f.sd_nama
      ) AS NamaBarang,
      (d.sod_jumlah * (d.sod_harga - d.sod_diskon)) AS total,
      IFNULL((
        SELECT SUM(m.mst_stok_in - m.mst_stok_out)
        FROM tmasterstok m 
        WHERE m.mst_aktif='Y' 
          AND m.mst_cab = h.so_cab
          AND m.mst_brg_kode = d.sod_kode 
          AND m.mst_ukuran = d.sod_ukuran
      ), 0) AS Stok
  FROM tso_hdr h
  JOIN tso_dtl d ON d.sod_so_nomor = h.so_nomor
  LEFT JOIN tbarangdc a ON a.brg_kode = d.sod_kode
  LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.sod_kode
  LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sod_kode AND b.brgd_ukuran = d.sod_ukuran
  LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
  LEFT JOIN tcustomer_level l ON l.level_kode = h.so_cus_level
  LEFT JOIN tgudang g ON g.gdg_kode = h.so_cab
  WHERE h.so_nomor = ?
  ORDER BY d.sod_nourut
`;

    const [mainRows] = await connection.query(mainQuery, [nomor]);

    if (mainRows.length === 0) {
      console.error(`❌ SO ${nomor} not found`);
      throw new Error(`Surat Pesanan dengan nomor ${nomor} tidak ditemukan.`);
    }

    const dpQuery = `
            SELECT 
                h.sh_nomor AS nomor,
                IF(h.sh_jenis=0, "TUNAI", IF(h.sh_jenis=1, "TRANSFER", "GIRO")) AS jenis,
                h.sh_nominal AS nominal,
                IF(j.jur_no IS NULL, "BELUM", "SUDAH") AS posting
            FROM tsetor_hdr h
            LEFT JOIN finance.tjurnal j ON j.jur_nomor = h.sh_nomor
            WHERE h.sh_otomatis = "N" AND h.sh_so_nomor = ?
        `;
    const [dpRows] = await connection.query(dpQuery, [nomor]);

    const firstRow = mainRows[0];

    // Format tanggal dengan proper handling
    const formatDate = (v) => {
      if (!v) return null;

      const d = new Date(v);
      if (isNaN(d.getTime())) return null;

      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");

      return `${yyyy}-${mm}-${dd}`;
    };

    const headerData = {
      nomor: firstRow.so_nomor,
      tanggal: formatDate(firstRow.so_tanggal),
      dateline: formatDate(firstRow.so_dateline),
      penawaran: firstRow.so_pen_nomor || "",
      keterangan: firstRow.so_ket || "",
      salesCounter: firstRow.so_sc || "",
      gudang: {
        kode: firstRow.gdg_kode || "",
        nama: firstRow.gdg_nama || "",
      },
      customer: {
        kode: firstRow.so_cus_kode || "",
        nama: firstRow.cus_nama || "",
        alamat: firstRow.cus_alamat || "",
        kota: firstRow.cus_kota || "",
        telp: firstRow.cus_telp || "",
      },
      levelKode: String(firstRow.so_cus_level || ""),
      levelNama: firstRow.level_nama || "",
      level: firstRow.xLevel || "",
      top: Number(firstRow.so_top || 0),
      ppnPersen: Number(firstRow.so_ppn || 0),
      statusSo: firstRow.so_aktif === "Y" ? "AKTIF" : "PASIF",
      canEdit: !isInvoiced,
    };

    const itemsData = mainRows.map((row, index) => {
      const item = {
        kode: row.sod_kode || "",
        nama: row.NamaBarang || "",
        ukuran: row.sod_ukuran || "",
        stok: Number(row.Stok || 0),
        jumlah: Number(row.sod_jumlah || 0),
        harga: Number(row.sod_harga || 0),
        diskonPersen: Number(row.sod_disc || 0),
        diskonRp: Number(row.sod_diskon || 0),
        total: Number(row.total || 0),
        barcode: row.brgd_barcode || "",
        noSoDtf: row.sod_sd_nomor || "",
        noPengajuanHarga: row.sod_ph_nomor || "",
      };
      return item;
    });

    const footerData = {
      diskonRp: Number(firstRow.so_disc || 0),
      diskonPersen1: Number(firstRow.so_disc1 || 0),
      diskonPersen2: Number(firstRow.so_disc2 || 0),
      biayaKirim: Number(firstRow.so_bkrm || 0),
    };

    const responseData = {
      headerData,
      itemsData,
      dpItemsData: dpRows,
      footerData,
    };

    return responseData;
  } catch (error) {
    console.error("💥 Error in getSoForEdit:", error);
    console.error("📍 Error details:", {
      message: error.message,
      stack: error.stack,
      nomor: nomor,
    });
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * @description Mencari Penawaran yang valid (belum jadi SO, belum di-close).
 */
const searchAvailablePenawaran = async (filters) => {
  const { cabang, customerKode, term } = filters;
  const searchTerm = `%${term}%`;

  let customerFilter = "";
  let params = [cabang];

  if (customerKode) {
    customerFilter = " AND h.pen_cus_kode = ? ";
    params.push(customerKode);
  }

  params.push(searchTerm, searchTerm);

  const query = `
        SELECT 
            h.pen_nomor AS nomor,
            h.pen_tanggal AS tanggal,
            h.pen_cus_kode AS kdcus,
            c.cus_nama AS customer,
            v.level_nama AS level,
            c.cus_alamat AS alamat,
            h.pen_ket AS keterangan
        FROM tpenawaran_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
        LEFT JOIN tcustomer_level v ON v.level_kode = h.pen_cus_level
        WHERE h.pen_alasan = ""
          AND h.pen_cab = ?
          ${customerFilter}
          AND h.pen_nomor NOT IN (SELECT so_pen_nomor FROM tso_hdr WHERE so_pen_nomor <> "")
          AND (h.pen_nomor LIKE ? OR c.cus_nama LIKE ?)
        ORDER BY h.pen_nomor DESC
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
 * @description Mengambil semua data dari Penawaran (DAN CUSTOMER) untuk diimpor ke SO.
 */
const getPenawaranDetailsForSo = async (nomor) => {
  // 1. Ambil Header, Customer, dan Level Info
  const headerQuery = `
    SELECT 
      h.pen_nomor, h.pen_top, h.pen_ket, h.pen_ppn, h.pen_bkrm, 
      h.pen_disc, h.pen_disc1, h.pen_disc2,
      
      -- Mengambil data Customer
      c.cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp, 
      c.cus_top AS customer_top, c.cus_franchise,
      
      -- Mengambil data Level (dari join)
      IFNULL(lvl.clh_level, '') AS level_kode,
      IFNULL(lvl.level_nama, '') AS level_nama,
      
      -- Mengambil data Discount Rule (dari join)
      IFNULL(rule.level_nominal, 0) AS nominal,
      IFNULL(rule.level_diskon, 0) AS diskon1,
      IFNULL(rule.level_diskon2, 0) AS diskon2

    FROM tpenawaran_hdr h
    
    -- Join untuk Customer
    LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
    
    -- Join untuk Level (Subquery untuk histori level terakhir)
    LEFT JOIN (
        SELECT v.clh_cus_kode, v.clh_level, l.level_nama
        FROM tcustomer_level_history v
        LEFT JOIN tcustomer_level l ON l.level_kode = v.clh_level
        -- Subquery ini harus menggunakan 'nomor' juga
        WHERE v.clh_cus_kode = (SELECT pen_cus_kode FROM tpenawaran_hdr WHERE pen_nomor = ?)
        ORDER BY v.clh_tanggal DESC LIMIT 1
    ) lvl ON lvl.clh_cus_kode = c.cus_kode
    
    -- Join untuk Aturan Diskon
    LEFT JOIN tcustomer_level rule ON rule.level_kode = lvl.clh_level

    WHERE h.pen_nomor = ?
  `;

  // 'nomor' dilempar 2x: 1x untuk subquery level, 1x untuk query utama
  const [headerRows] = await pool.query(headerQuery, [nomor, nomor]);

  if (headerRows.length === 0)
    throw new Error("Data Penawaran tidak ditemukan.");

  const penawaranHeader = headerRows[0];

  // 2. Buat objek customer baru dari hasil query
  const customerData = {
    kode: penawaranHeader.cus_kode,
    nama: penawaranHeader.cus_nama,
    alamat: penawaranHeader.cus_alamat,
    kota: penawaranHeader.cus_kota,
    telp: penawaranHeader.cus_telp,
    top: penawaranHeader.customer_top, // Ambil top dari customer, bukan penawaran
    franchise: penawaranHeader.cus_franchise,
    level_kode: penawaranHeader.level_kode,
    level_nama: penawaranHeader.level_nama,
    discountRule: {
      nominal: penawaranHeader.nominal,
      diskon1: penawaranHeader.diskon1,
      diskon2: penawaranHeader.diskon2,
    },
  };

  // 3. Ambil Detail (Query lama Anda sudah benar)
  const [detailRows] = await pool.query(
    `
  SELECT 
    d.pend_kode AS kode,
    TRIM(CONCAT(
        COALESCE(a.brg_jeniskaos, ''), ' ',
        COALESCE(a.brg_tipe, ''), ' ',
        COALESCE(a.brg_lengan, ''), ' ',
        COALESCE(a.brg_jeniskain, ''), ' ',
        COALESCE(a.brg_warna, '')
    )) AS nama,
    d.pend_ukuran AS ukuran,
    d.pend_jumlah AS jumlah,
    d.pend_harga AS harga,
    d.pend_disc AS diskonPersen,
    d.pend_diskon AS diskonRp,
    (d.pend_jumlah * (d.pend_harga - d.pend_diskon)) AS total,
    b.brgd_barcode AS barcode,
    d.pend_sd_nomor AS noSoDtf,
    d.pend_ph_nomor AS noPengajuanHarga
  FROM tpenawaran_dtl d
  LEFT JOIN tbarangdc a ON a.brg_kode = d.pend_kode
  LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.pend_kode AND b.brgd_ukuran = d.pend_ukuran
  LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.pend_kode
  WHERE d.pend_nomor = ? 
  ORDER BY d.pend_nourut
`,
    [nomor]
  );

  // 4. Kembalikan semua data
  return {
    header: penawaranHeader,
    details: detailRows,
    customer: customerData, // <-- DATA CUSTOMER DITAMBAHKAN DI SINI
  };
};

const getDefaultDiscount = async (
  levelKode,
  total,
  gudang,
  hasPin,
  hasAcc,
  penawaran
) => {
  let discount = 0;

  // 1️⃣ Jika sudah ada PIN / ACC / Penawaran → TIDAK pakai diskon otomatis
  if (hasPin || hasAcc === "Y" || penawaran) {
    return { discount: 0 };
  }

  // 2️⃣ Jika level mulai dengan '5' → tidak dapat diskon otomatis
  if (String(levelKode).startsWith("5")) {
    return { discount: 0 };
  }

  // 3️⃣ Gudang KDC-K04 → tidak dapat diskon otomatis
  if (gudang.includes("KDC-K04")) {
    return { discount: 0 };
  }

  // 4️⃣ Gudang KPR → FIX 15%
  if (gudang === "KPR") {
    return { discount: 15 };
  }

  // 5️⃣ Ambil data level
  const q = "SELECT * FROM tcustomer_level WHERE level_kode = ?";
  const [rows] = await pool.query(q, [String(levelKode).charAt(0)]);

  if (rows.length === 0) {
    return { discount: 0 };
  }

  const levelData = rows[0];

  // 6️⃣ Level 8 → langsung pakai level_diskon
  if (String(levelKode).startsWith("8")) {
    return { discount: levelData.level_diskon };
  }

  // 7️⃣ Level normal: pakai dua threshold
  if (total >= levelData.level_nominal) {
    discount = levelData.level_diskon;
  } else if (total >= levelData.level_nominal2) {
    discount = levelData.level_diskon2;
  } else {
    discount = 0;
  }

  return { discount };
};

const searchAvailableSetoran = async (filters) => {
  const { cabang, customerKode, soNomor, term } = filters;
  const searchTerm = `%${term}%`;
  const query = `
        SELECT x.Nomor, x.Tanggal, x.Jenis, x.Posting, x.Fsk, x.Nominal 
        FROM (
            SELECT 
                h.sh_nomor AS Nomor, h.sh_tanggal AS Tanggal, 
                IF(h.sh_jenis=0, "TUNAI", IF(h.sh_jenis=1, "TRANSFER", "GIRO")) AS Jenis, 
                h.sh_nominal AS Nominal,
                IFNULL((SELECT SUM(d.sd_bayar) FROM tsetor_dtl d WHERE d.sd_sh_nomor = h.sh_nomor), 0) AS Terpakai,
                IF(j.jur_no IS NULL, "BELUM", "SUDAH") AS Posting,
                IF(f.fskd_nomor IS NULL, "N", "Y") AS fsk
            FROM tsetor_hdr h
            LEFT JOIN tform_setorkasir_dtl f ON f.fskd_sh_nomor = h.sh_nomor
            LEFT JOIN finance.tjurnal j ON j.jur_nomor = h.sh_nomor
            WHERE h.sh_otomatis = "N" 
              AND (h.sh_so_nomor = "" OR h.sh_so_nomor = ?) 
              AND j.jur_no IS NULL
              AND h.sh_cab = ? AND h.sh_cus_kode = ?
              AND h.sh_nomor LIKE ?
        ) x 
        WHERE (x.Nominal - x.Terpakai) > 0
    `;
  const [rows] = await pool.query(query, [
    soNomor,
    cabang,
    customerKode,
    searchTerm,
  ]);
  return rows;
};

/**
 * @description Membuat nomor Setoran DP baru (getmaxdp versi Delphi).
 */
const generateNewDpNumber = async (connection, cabang, tanggal) => {
  // Format tanggal ke 'yymm'
  const datePrefix = format(new Date(tanggal), "yyMM");

  // Buat prefix lengkap, contoh: K01.STR.2509
  const prefix = `${cabang}.STR.${datePrefix}`;

  // Query versi baru: pakai sh_cab + LIKE prefix
  const query = `
        SELECT IFNULL(MAX(CAST(RIGHT(sh_nomor, 4) AS UNSIGNED)), 0) AS lastNum
        FROM tsetor_hdr
        WHERE sh_cab = ?
          AND sh_nomor LIKE CONCAT(?, '%')
    `;

  const [rows] = await connection.query(query, [cabang, prefix]);

  const lastNum = parseInt(rows[0].lastNum, 10);
  const newNum = lastNum + 1;

  // Format nomor urut menjadi 4 digit dengan padding nol
  const sequentialPart = String(newNum).padStart(4, "0");

  return `${prefix}.${sequentialPart}`;
};

/**
 * @description Menyimpan data DP baru.
 */
const saveNewDp = async (dpData, user) => {
  const {
    customerKode,
    tanggal,
    jenis,
    nominal,
    keterangan,
    bankData,
    giroData,
    nomorSo, // DP SELALU UNTUK SO
  } = dpData;

  const soNomor = nomorSo || "";

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
      [cabang, prefix]
    );

    const lastNum = parseInt(maxRows[0].maxNum, 10);
    const nextNum = lastNum + 1;
    const sequentialPart = String(nextNum).padStart(4, "0");
    const dpNomor = `${prefix}.${sequentialPart}`;

    // 2. siapkan sh_idrec (supaya mirip Delphi: K06SHyyyymmdd...)
    const idrec = `${cabang}SH${format(new Date(), "yyyyMMddHHmmssSSS")}`;

    // 3. Tentukan jenis
    const jenisNum = jenis === "TUNAI" ? 0 : jenis === "TRANSFER" ? 1 : 2;

    let query, params;

    if (jenis === "TUNAI") {
      query = `
        INSERT INTO tsetor_hdr (
          sh_idrec,
          sh_nomor,
          sh_cus_kode,
          sh_tanggal,
          sh_jenis,
          sh_nominal,
          sh_ket,
          sh_cab,
          sh_so_nomor,
          sh_otomatis,
          user_create,
          date_create
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N', ?, NOW()
        )
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
        soNomor,
        user.kode,
      ];
    } else if (jenis === "TRANSFER") {
      query = `
        INSERT INTO tsetor_hdr (
          sh_idrec,
          sh_nomor,
          sh_cus_kode,
          sh_tanggal,
          sh_jenis,
          sh_nominal,
          sh_akun,
          sh_norek,
          sh_tgltransfer,
          sh_ket,
          sh_so_nomor,
          sh_cab,
          sh_otomatis,
          user_create,
          date_create
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N', ?, NOW()
        )
      `;

      // ⚠ urutan params HARUS sesuai urutan kolom di atas
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
        soNomor, // sh_so_nomor
        cabang, // sh_cab
        user.kode,
      ];
    } else if (jenis === "GIRO") {
      query = `
        INSERT INTO tsetor_hdr (
          sh_idrec,
          sh_nomor,
          sh_cus_kode,
          sh_tanggal,
          sh_jenis,
          sh_nominal,
          sh_giro,
          sh_tglgiro,
          sh_tempogiro,
          sh_ket,
          sh_cab,
          sh_so_nomor,
          sh_otomatis,
          user_create,
          date_create
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N', ?, NOW()
        )
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
        soNomor,
        user.kode,
      ];
    } else {
      throw new Error("Jenis DP tidak dikenal.");
    }

    // 4. Simpan HEADER DP (tanpa detail dulu)
    await connection.query(query, params);

    // ❌ TIDAK ADA insert tsetor_dtl di sini.
    // DP baru akan dibuat "terpakai" saat:
    // - Invoice saveData → insert tsetor_dtl (sd_ket = 'DP LINK DARI INV')
    // - Form Setoran manual → insert tsetor_dtl pembayaran invoice

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

/**
 * @description Mencari rekening bank yang tersedia untuk cabang tertentu.
 */
const searchRekening = async (filters) => {
  const { cabang, term } = filters;
  const searchTerm = `%${term || ""}%`;
  const query = `
        SELECT 
            rek_kode AS kode,
            rek_nama AS nama,
            rek_rekening AS rekening
        FROM finance.trekening 
        WHERE rek_kaosan LIKE ? 
          AND (rek_kode LIKE ? OR rek_nama LIKE ?)
    `;
  const [rows] = await pool.query(query, [
    `%${cabang}%`,
    searchTerm,
    searchTerm,
  ]);
  return rows;
};

/**
 * Mengubah angka menjadi format teks Rupiah.
 * Contoh: 12345 -> "dua belas ribu tiga ratus empat puluh lima"
 */
function terbilang(n) {
  if (n === null || n === undefined || isNaN(n)) return "Nol";
  n = Math.floor(Math.abs(n));

  const ang = [
    "",
    "satu",
    "dua",
    "tiga",
    "empat",
    "lima",
    "enam",
    "tujuh",
    "delapan",
    "sembilan",
    "sepuluh",
    "sebelas",
  ];

  const terbilangRecursive = (num) => {
    if (num < 12) return ang[num];
    if (num < 20) return terbilangRecursive(num - 10) + " belas";
    if (num < 100)
      return (
        (ang[Math.floor(num / 10)] || "") +
        " puluh " +
        terbilangRecursive(num % 10)
      );
    if (num < 200) return "seratus " + terbilangRecursive(num - 100);
    if (num < 1000)
      return (
        terbilangRecursive(Math.floor(num / 100)) +
        " ratus " +
        terbilangRecursive(num % 100)
      );
    if (num < 2000) return "seribu " + terbilangRecursive(num - 1000);
    if (num < 1000000)
      return (
        terbilangRecursive(Math.floor(num / 1000)) +
        " ribu " +
        terbilangRecursive(num % 1000)
      );
    if (num < 1000000000)
      return (
        terbilangRecursive(Math.floor(num / 1000000)) +
        " juta " +
        terbilangRecursive(n % 1000000)
      );
    // Bisa ditambahkan Miliar, Triliun, dst.
    return "angka terlalu besar";
  };

  return terbilangRecursive(n).replace(/\s+/g, " ").trim();
}

/**
 * Helper untuk membuat huruf pertama menjadi kapital.
 * Contoh: "dua belas ribu" -> "Dua belas ribu"
 */
const capitalize = (s) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";

/**
 * @description Mengambil semua data yang diperlukan untuk mencetak Cash Receipt (DP).
 */
const getDataForDpPrint = async (nomorSetoran) => {
  // Query ini telah dibuat lebih aman dengan IFNULL
  const query = `
        SELECT 
            h.sh_nomor, h.sh_tanggal, h.sh_nominal, h.sh_ket,
            IF(h.sh_jenis=0, 'TUNAI', IF(h.sh_jenis=1, 'TRANSFER', 'GIRO')) AS jenis_pembayaran,
            c.cus_nama, c.cus_alamat, c.cus_telp,
            h.sh_so_nomor,
            IFNULL(r.rek_nama, '') AS nama_akun, 
            IFNULL(r.rek_rekening, '') AS no_rekening,
            DATE_FORMAT(h.sh_tgltransfer, "%d-%m-%Y") AS tgl_transfer,
            h.user_create
        FROM tsetor_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.sh_cus_kode
        LEFT JOIN finance.trekening r ON r.rek_kode = h.sh_akun
        WHERE h.sh_nomor = ?
    `;
  const [rows] = await pool.query(query, [nomorSetoran]);
  if (rows.length === 0) return null;

  const data = rows[0];

  // Tambahkan pengecekan keamanan sebelum memanggil terbilang
  const nominal = parseFloat(data.sh_nominal);
  if (!isNaN(nominal)) {
    data.terbilang = capitalize(terbilang(nominal)) + " Rupiah";
  } else {
    data.terbilang = "Nominal tidak valid";
  }

  return data;
};

const findByBarcode = async (barcode, gudang) => {
  const query = `
        SELECT
            d.brgd_barcode AS barcode,
            d.brgd_kode AS kode,
            TRIM(CONCAT(h.brg_jeniskaos, " ", h.brg_tipe, " ", h.brg_lengan, " ", h.brg_jeniskain, " ", h.brg_warna)) AS nama,
            d.brgd_ukuran AS ukuran,
            d.brgd_harga AS harga,
            
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

const searchJenisOrder = async (term = "") => {
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

const hitungHarga = async ({ jenis, ukuran, titik, items }) => {
  const factor = jenis === "CUSTOM" ? 1.15 : 1; // markup contoh 15% utk custom
  const hasil = items.map((it) => ({
    ...it,
    harga: Math.round((it.harga || 0) * factor + titik * 5000),
    total:
      (it.jumlah || 0) * Math.round((it.harga || 0) * factor + titik * 5000),
  }));
  return hasil;
};

const calculateHargaCustom = async (form) => {
  const totalJumlah = form.detailsUkuran.reduce(
    (a, b) => a + (b.jumlah || 0),
    0
  );
  const hargaPerCm = 500; // contoh hitungan awal per cm
  let totalHarga = 0;

  for (const titik of form.detailsTitik) {
    const area = (titik.panjang || 0) * (titik.lebar || 0);
    totalHarga += area * hargaPerCm;
  }

  return {
    totalJumlah,
    totalHarga,
  };
};

const deleteDp = async (nomorSetoran) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    await connection.query(
      "UPDATE tsetor_hdr SET sh_so_nomor = '' WHERE sh_nomor = ?",
      [nomorSetoran]
    );
    // 1. Hapus detail setoran jika ada
    await connection.query("DELETE FROM tsetor_dtl WHERE sd_sh_nomor = ?", [
      nomorSetoran,
    ]);

    // 2. Hapus header setoran
    const [result] = await connection.query(
      "DELETE FROM tsetor_hdr WHERE sh_nomor = ? AND sh_otomatis = 'N'",
      [nomorSetoran]
    );

    if (result.affectedRows === 0) {
      throw new Error("DP tidak ditemukan atau tidak bisa dihapus.");
    }

    await connection.commit();
    return { success: true, message: `DP ${nomorSetoran} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  save,
  getSoForEdit,
  getPenawaranDetailsForSo,
  searchAvailablePenawaran,
  getDefaultDiscount,
  searchAvailableSetoran,
  generateNewDpNumber,
  saveNewDp,
  searchRekening,
  getDataForDpPrint,
  findByBarcode,
  searchJenisOrder,
  hitungHarga,
  calculateHargaCustom,
  deleteDp,
};
