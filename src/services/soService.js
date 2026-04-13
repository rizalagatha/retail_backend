const pool = require("../config/database");
const { format } = require("date-fns");

// Mengambil daftar data (SQLMaster)
const getList = async (filters) => {
  const { startDate, endDate, cabang, status } = filters;
  let params = [startDate, endDate];

  let branchFilter = "";
  if (cabang === "ALL") {
    // Jika ALL, jangan pakai filter cabang sama sekali (Tampilkan Semua)
    branchFilter = "";
  } else if (cabang === "KDC") {
    // Jika KDC (Default), tampilkan gudang milik DC saja
    branchFilter =
      "AND h.so_cab IN (SELECT gdg_kode FROM tgudang WHERE gdg_dc = 1)";
  } else if (cabang) {
    // Jika cabang spesifik (misal K01, K02)
    branchFilter = "AND h.so_cab = ?";
    params.push(cabang);
  }

  let statusFilter = "";
  if (status === "open") {
    statusFilter = " HAVING Status = 'OPEN'";
  }

  const query = `
    SELECT 
        y.Nomor, y.Tanggal, y.Dateline, y.Penawaran, y.Top, y.Nominal, y.Diskon, y.Dp, 
        y.QtySO, y.QtyInv, y.Belum, y.AlasanClose, y.StatusKirim,
        y.kdcus, y.Nama, y.Alamat, y.Kota, y.Level, y.Keterangan, y.Aktif, y.SC,
        y.DipakaiDTF,

        y.MpPesanan, y.MpResi,

        y.Disc1, y.Disc2, y.Promo, y.Ppn, y.Bkrm,

        y.NoSPK,

        (CASE
            WHEN y.DipakaiDTF = 'Y' AND y.Belum = 0 THEN 'CLOSE'
            WHEN y.sts = 2 THEN "DICLOSE"
            WHEN y.StatusKirim = "TERKIRIM" THEN "CLOSE"
            WHEN y.StatusKirim = "BELUM" AND y.keluar = 0 AND y.minta = "" AND y.pesan = 0 THEN "OPEN"
            WHEN y.StatusKirim = "BELUM" AND y.QtySO = y.pesan THEN "JADI"
            ELSE "PROSES"
        END) AS Status

    FROM (
        SELECT 
            x.*,
            IF(x.QtyInv = 0, "BELUM", IF(x.QtyInv >= x.QtySO, "TERKIRIM", "SEBAGIAN")) AS StatusKirim,

            IFNULL((
                SELECT SUM(m.mst_stok_out)
                FROM tmasterstok m 
                WHERE m.mst_noreferensi IN (
                    SELECT o.mo_nomor FROM tmutasiout_hdr o WHERE o.mo_so_nomor = x.Nomor
                )
                AND MID(m.mst_noreferensi, 4, 3) NOT IN ("MSO","MSI")
            ), 0) AS keluar,

            IFNULL((
                SELECT m.mt_nomor 
                FROM tmintabarang_hdr m 
                WHERE m.mt_so = x.Nomor 
                LIMIT 1
            ), "") AS minta,

            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out)
                FROM tmasterstokso m
                WHERE m.mst_aktif = "Y" AND m.mst_nomor_so = x.Nomor
            ), 0) AS pesan

        FROM (
            SELECT 
                h.so_nomor AS Nomor,
                h.so_pen_nomor AS Penawaran,
                h.so_dateline AS Dateline,
                h.so_tanggal AS Tanggal,
                h.so_top AS Top,
                h.so_disc AS Diskon,
                h.so_dp AS Dp,
                h.so_disc1 AS Disc1,
                h.so_disc2 AS Disc2,
                h.so_pro_nomor AS Promo,
                h.so_ppn AS Ppn,
                h.so_bkrm AS Bkrm,
                h.user_modified AS UserModified,
                h.date_modified AS DateModified,
                h.so_mp_nomor_pesanan AS MpPesanan,
                h.so_mp_resi AS MpResi,

                IFNULL((
                    SELECT GROUP_CONCAT(spk_nomor SEPARATOR ', ')
                    FROM kencanaprint.tspk 
                    WHERE spk_invdc = h.so_nomor AND spk_aktif = 'Y' 
                ), "") AS NoSPK,

                (SELECT ROUND(
                    SUM(dd.sod_jumlah * (dd.sod_harga - dd.sod_diskon))
                    - hh.so_disc 
                    + (hh.so_ppn / 100 * (SUM(dd.sod_jumlah * (dd.sod_harga - dd.sod_diskon)) - hh.so_disc))
                    + hh.so_bkrm
                )
                FROM tso_dtl dd 
                JOIN tso_hdr hh ON hh.so_nomor = dd.sod_so_nomor 
                WHERE hh.so_nomor = h.so_nomor) AS Nominal,

                IFNULL((SELECT SUM(dd.sod_jumlah)
                        FROM tso_dtl dd
                        WHERE dd.sod_so_nomor = h.so_nomor), 0) AS QtySO,

                IFNULL((SELECT SUM(dd.invd_jumlah)
                        FROM tinv_hdr hh 
                        JOIN tinv_dtl dd ON dd.invd_inv_nomor = hh.inv_nomor 
                        WHERE hh.inv_sts_pro = 0 
                        AND hh.inv_nomor_so = h.so_nomor), 0) AS QtyInv,

                (IFNULL((SELECT SUM(dd.sod_jumlah)
                         FROM tso_dtl dd 
                         WHERE dd.sod_so_nomor = h.so_nomor), 0)
                 -
                 IFNULL((SELECT SUM(dd.invd_jumlah)
                         FROM tinv_hdr hh 
                         JOIN tinv_dtl dd ON dd.invd_inv_nomor = hh.inv_nomor 
                         WHERE hh.inv_sts_pro = 0 
                         AND hh.inv_nomor_so = h.so_nomor), 0)
                ) AS Belum,

                h.so_cus_kode AS kdcus,
                s.cus_nama AS Nama,
                s.cus_alamat AS Alamat,
                s.cus_kota AS Kota,
                CONCAT(h.so_cus_level, " - ", l.level_nama) AS Level,
                h.so_ket AS Keterangan,

                h.so_close AS sts,
                h.so_aktif AS Aktif,
                h.so_alasan AS AlasanClose,
                h.so_sc AS SC,
                (
  SELECT 'Y'
  FROM tsodtf_hdr d
  WHERE d.sd_nomor IN (
      SELECT DISTINCT sod_sd_nomor
      FROM tso_dtl dd
      WHERE dd.sod_so_nomor = h.so_nomor
  )
  LIMIT 1
) AS DipakaiDTF

            FROM tso_hdr h
            LEFT JOIN tcustomer s ON s.cus_kode = h.so_cus_kode
            LEFT JOIN tcustomer_level l ON l.level_kode = h.so_cus_level
            WHERE h.so_tanggal BETWEEN ? AND ?
            ${branchFilter}
        ) x
    ) y

    ${statusFilter}

    ORDER BY y.Tanggal, y.Nomor;
  `;

  const [rows] = await pool.query(query, params);
  return rows;
};

const getCabangList = async (user) => {
  let query;
  // Logika dari FormCreate Delphi
  if (user.cabang === "KDC") {
    // Untuk KDC, ambil semua cabang kecuali KBS dan KPS
    query = `SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode NOT IN ("KBS", "KPS") ORDER BY gdg_kode`;
  } else {
    // Untuk cabang biasa, hanya ambil cabangnya sendiri
    query = `SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode = ?`;
  }
  const [rows] = await pool.query(query, [user.cabang]);

  return rows;
};

// Mengambil data detail (SQLDetail)
const getDetails = async (nomor) => {
  const query = `
    SELECT 
        x.Kode, 
        x.Barcode, 
        x.Nama, 
        x.Ukuran, 
        x.QtySO, 
        x.Harga, 
        x.TotalSO, 
        x.QtyInvoice,
        (IF(x.QtyInvoice >= x.QtySO, 0, x.QtySO - x.QtyInvoice)) AS BlmJadiInvoice 
    FROM (
        SELECT 
            d.sod_kode AS Kode,
            IFNULL(b.brgd_barcode, "") AS Barcode,
            -- Urutan prioritas nama: Barang DC → DTF → Custom
            COALESCE(
              TRIM(CONCAT(
                a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna
              )),
              f.sd_nama,
              d.sod_custom_nama
            ) AS Nama,
            d.sod_ukuran AS Ukuran,
            d.sod_jumlah AS QtySO,
            d.sod_harga AS Harga,
            (d.sod_jumlah * (d.sod_harga - d.sod_diskon)) AS TotalSO,
            IFNULL((
                SELECT SUM(i.invd_jumlah) 
                FROM tinv_hdr j 
                JOIN tinv_dtl i ON i.invd_inv_nomor = j.inv_nomor
                WHERE j.inv_sts_pro = 0 
                  AND j.inv_nomor_so = h.so_nomor 
                  AND i.invd_kode = d.sod_kode 
                  AND i.invd_ukuran = d.sod_ukuran
            ), 0) AS QtyInvoice
        FROM tso_dtl d
        JOIN tso_hdr h ON h.so_nomor = d.sod_so_nomor
        LEFT JOIN tbarangdc a ON a.brg_kode = d.sod_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sod_kode AND b.brgd_ukuran = d.sod_ukuran
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.sod_kode
        WHERE d.sod_so_nomor = ?
    ) x
    ORDER BY x.Kode, x.Ukuran
  `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

function terbilang(n) {
  if (n === null || n === undefined || n === 0) return "Nol";
  if (n < 0) return "minus " + terbilang(-n);
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
        ang[Math.floor(num / 10)] + " puluh " + terbilangRecursive(num % 10)
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
    return "angka terlalu besar";
  };
  return terbilangRecursive(Math.floor(n)).replace(/\s+/g, " ").trim();
}
const capitalize = (s) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";

const getDataForPrint = async (nomor) => {
  // 1. Ambil data Header, Customer, dan Gudang
  const headerQuery = `
    SELECT 
        h.so_nomor, h.so_tanggal, h.so_top, h.so_ket, h.so_sc, h.user_create,
        DATE_FORMAT(h.date_create, "%d-%m-%Y %T") AS created,
        h.so_disc, h.so_ppn, h.so_bkrm, h.so_dp,
        c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp,
        g.gdg_inv_nama, g.gdg_inv_alamat, g.gdg_inv_kota, g.gdg_inv_telp,
        g.gdg_inv_instagram, 
        g.gdg_akun,
        g.gdg_transferbank,
        g.gdg_inv_komplain
    FROM tso_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
    LEFT JOIN tgudang g ON g.gdg_kode = h.so_cab
    WHERE h.so_nomor = ?
  `;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0) return null;
  const header = headerRows[0];

  // 2. Ambil data Detail (include JSON custom)
  const detailQuery = `
    SELECT 
        d.sod_custom,
        d.sod_custom_nama,
        d.sod_custom_data,
        d.sod_ukuran AS ukuran_asli,
        d.sod_jumlah AS qty,
        d.sod_harga AS harga,
        d.sod_diskon AS diskon,
        (d.sod_jumlah * (d.sod_harga - d.sod_diskon)) AS total,

        -- Nama barang normal
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama_normal,

        -- Nama DTF jika ada di tsodtf_hdr (fallback lama)
        f.sd_nama AS nama_dtf_lama

    FROM tso_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.sod_kode
    LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.sod_kode
    WHERE d.sod_so_nomor = ?
    ORDER BY d.sod_nourut
  `;
  const [rows] = await pool.query(detailQuery, [nomor]);

  // 3. Proses detail untuk custom data (JSON parse)
  const details = rows.map((item) => {
    let nama_barang = item.nama_normal;
    let ukuran = item.ukuran_asli;

    if (item.sod_custom === "Y") {
      nama_barang = item.sod_custom_nama || "CUSTOM ORDER";

      try {
        const parsed = JSON.parse(item.sod_custom_data);

        // Ambil ukuran pertama (L, XL, dst.)
        if (Array.isArray(parsed.ukuranKaos) && parsed.ukuranKaos.length > 0) {
          ukuran = parsed.ukuranKaos[0].ukuran || "";
        }
      } catch (e) {
        // ignore JSON parse error, fallback to existing
      }
    } else {
      // Jika bukan custom tapi nama normal null → fallback dari tsodtf_hdr
      if (!nama_barang) nama_barang = item.nama_dtf_lama;
    }

    return {
      nama_barang,
      ukuran,
      qty: item.qty,
      harga: item.harga,
      diskon: item.diskon,
      total: item.total,
    };
  });

  // 4. Kalkulasi Total & Terbilang
  const total = details.reduce((sum, it) => sum + it.total, 0);
  const diskon_faktur = header.so_disc || 0;
  const netto = total - diskon_faktur;
  const ppn = header.so_ppn ? netto * (header.so_ppn / 100) : 0;
  const grand_total = netto + ppn + (header.so_bkrm || 0);
  const belumbayar = grand_total - (header.so_dp || 0);

  const summary = {
    total,
    diskon: diskon_faktur,
    ppn,
    biaya_kirim: header.so_bkrm || 0,
    grand_total,
    dp: header.so_dp || 0,
    belumbayar,
    terbilang: capitalize(terbilang(grand_total)) + " Rupiah",
  };

  return { header, details, summary };
};

const close = async (data) => {
  const { nomor, alasan, user } = data;

  // 1. Ambil status SO saat ini dengan query yang benar untuk validasi
  // Query ini adalah versi ringkas dari query getList, khusus untuk satu nomor SO
  const statusQuery = `
        SELECT 
            (CASE
                WHEN y.sts = 2 THEN "DICLOSE"
                WHEN y.StatusKirim = "TERKIRIM" THEN "CLOSE"
                WHEN y.StatusKirim = "BELUM" AND y.keluar = 0 AND y.minta = "" AND y.pesan = 0 THEN "OPEN"
                WHEN y.StatusKirim = "BELUM" AND y.QtySO = y.pesan THEN "JADI"
                ELSE "PROSES"
            END) AS Status
        FROM (
            SELECT 
                x.*,
                IF(x.QtyInv = 0, "BELUM", IF(x.QtyInv >= x.QtySO, "TERKIRIM", "SEBAGIAN")) AS StatusKirim,
                IFNULL((SELECT SUM(m.mst_stok_out) FROM tmasterstok m WHERE m.mst_noreferensi IN (SELECT o.mo_nomor FROM tmutasiout_hdr o WHERE o.mo_so_nomor = x.Nomor) AND mid(m.mst_noreferensi, 4, 3) NOT IN ("MSO", "MSI")), 0) AS keluar,
                IFNULL((SELECT m.mt_nomor FROM tmintabarang_hdr m WHERE m.mt_so = x.Nomor LIMIT 1), "") AS minta,
                IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstokso m WHERE m.mst_aktif = "Y" AND m.mst_nomor_so = x.Nomor), 0) AS pesan
            FROM (
                SELECT 
                    h.so_nomor AS Nomor, h.so_close AS sts,
                    IFNULL((SELECT SUM(dd.sod_jumlah) FROM tso_dtl dd WHERE dd.sod_so_nomor = h.so_nomor), 0) AS QtySO,
                    IFNULL((SELECT SUM(dd.invd_jumlah) FROM tinv_hdr hh JOIN tinv_dtl dd ON dd.invd_inv_nomor = hh.inv_nomor WHERE hh.inv_sts_pro = 0 AND hh.inv_nomor_so = h.so_nomor), 0) AS QtyInv
                FROM tso_hdr h
                WHERE h.so_nomor = ?
            ) x
        ) y
    `;
  const [rows] = await pool.query(statusQuery, [nomor]);
  if (rows.length === 0) {
    throw new Error("Surat Pesanan tidak ditemukan.");
  }
  const currentStatus = rows[0].Status;

  // 2. Validasi dari Delphi
  if (currentStatus === "CLOSE" || currentStatus === "DICLOSE") {
    throw new Error("Surat Pesanan ini sudah berstatus CLOSE.");
  }

  // 3. Update data di database
  const updateQuery = `
        UPDATE tso_hdr 
        SET so_close = 2, -- '2' untuk status DICLOSE
            so_alasan = ?, 
            user_modified = ?, 
            date_modified = NOW() 
        WHERE so_nomor = ?
    `;
  await pool.query(updateQuery, [alasan, user, nomor]);

  return {
    success: true,
    message: `Surat Pesanan ${nomor} berhasil di-close.`,
  };
};

const remove = async (nomor, user) => {
  // 1. Ambil data SO untuk validasi
  const [rows] = await pool.query(
    "SELECT so_nomor, so_close FROM tso_hdr WHERE so_nomor = ?",
    [nomor],
  );
  if (rows.length === 0) {
    throw new Error("Surat Pesanan tidak ditemukan.");
  }
  const so = rows[0];

  // 2. Migrasi Validasi dari Delphi
  // Validasi Status: hanya boleh 'OPEN' (so_close = 0)
  if (so.so_close !== 0) {
    throw new Error("SO yang sudah diproses atau di-close tidak bisa dihapus.");
  }

  // Validasi Kepemilikan Cabang
  const cabangSo = nomor.substring(0, 3);
  if (user.cabang !== "KDC" && user.cabang !== cabangSo) {
    throw new Error(
      `Anda tidak berhak menghapus data milik cabang ${cabangSo}.`,
    );
  }

  // 3. Jika semua validasi lolos, hapus data
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    // Asumsi foreign key dari tso_dtl ke tso_hdr diset ON DELETE CASCADE
    await connection.query("DELETE FROM tso_hdr WHERE so_nomor = ?", [nomor]);
    await connection.commit();
    return {
      success: true,
      message: `Surat Pesanan ${nomor} berhasil dihapus.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getExportDetails = async (filters) => {
  const { startDate, endDate, cabang, status, search } = filters;
  const params = [startDate, endDate];

  // 1. Filter Cabang
  let branchFilter = "";
  // [FIX] Jika KDC dan pilih ALL, jangan pakai filter apapun (Tampilkan semua)
  if (cabang === "KDC") {
    // Jika KDC default (bukan ALL), biasanya ada logic khusus?
    // Tapi kalau di InvoiceView logicnya "ALL" = No Filter.
    // Kita asumsikan default view KDC adalah list cabang tertentu, tapi kalau ALL ya semua.
    branchFilter =
      "AND h.so_cab IN (SELECT gdg_kode FROM tgudang WHERE gdg_dc = 1)";
  } else if (cabang && cabang !== "ALL") {
    // Jika user cabang biasa ATAU KDC memilih cabang spesifik
    branchFilter = "AND h.so_cab = ?";
    params.push(cabang);
  }
  // Jika cabang == "ALL", branchFilter tetap string kosong "" (No Filter)

  // 2. Filter Search (Opsional, agar hasil export sesuai tampilan tabel)
  let searchFilter = "";
  if (search) {
    searchFilter = `
      AND (
        h.so_nomor LIKE ? OR 
        c.cus_nama LIKE ? 
      )
    `;
    const term = `%${search}%`;
    params.push(term, term);
  }

  // 3. Filter Status (Open / Sisa Piutang Logic)
  // Kita perlu subquery/CTE ringkas untuk menentukan status SO sebelum join detail
  // Logic OPEN: so_close = 0 (Belum manual close) DAN (QtySO > QtyInv)
  let statusClause = "";
  if (status === "open") {
    // Kita filter di WHERE utama menggunakan Subquery exists
    // Cari SO yang QtyOrder > QtyInvoice
    statusClause = `
      AND h.so_close = 0 -- Belum Close Manual
      AND (
        (SELECT SUM(sod_jumlah) FROM tso_dtl WHERE sod_so_nomor = h.so_nomor) 
        > 
        IFNULL((SELECT SUM(invd_jumlah) 
                FROM tinv_dtl id 
                JOIN tinv_hdr ih ON ih.inv_nomor = id.invd_inv_nomor 
                WHERE ih.inv_sts_pro = 0 AND ih.inv_nomor_so = h.so_nomor), 0)
      )
    `;
  }

  const query = `
        SELECT 
            h.so_nomor AS 'Nomor SO',
            DATE_FORMAT(h.so_tanggal, '%Y-%m-%d') AS 'Tanggal', -- Format ISO agar mudah diparsing frontend
            c.cus_nama AS 'Customer',
            d.sod_kode AS 'Kode Barang',
            
            -- Nama Barang (Gabungan DC / DTF / Custom)
            COALESCE(
              TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), " ", IFNULL(a.brg_tipe,''), " ", IFNULL(a.brg_lengan,''), " ", IFNULL(a.brg_jeniskain,''), " ", IFNULL(a.brg_warna,''))),
              f.sd_nama,
              d.sod_custom_nama
            ) AS Nama,
            
            d.sod_ukuran AS 'Ukuran',
            d.sod_jumlah AS 'Qty SO',
            
            -- [TAMBAHAN] Qty Terkirim & Sisa (Penting untuk laporan Open SO)
            IFNULL((
                SELECT SUM(id.invd_jumlah) 
                FROM tinv_dtl id 
                JOIN tinv_hdr ih ON ih.inv_nomor = id.invd_inv_nomor 
                WHERE ih.inv_sts_pro = 0 
                  AND ih.inv_nomor_so = h.so_nomor 
                  AND id.invd_kode = d.sod_kode 
                  AND id.invd_ukuran = d.sod_ukuran
            ), 0) AS 'Qty Kirim',
            
            (d.sod_jumlah - IFNULL((
                SELECT SUM(id.invd_jumlah) 
                FROM tinv_dtl id 
                JOIN tinv_hdr ih ON ih.inv_nomor = id.invd_inv_nomor 
                WHERE ih.inv_sts_pro = 0 
                  AND ih.inv_nomor_so = h.so_nomor 
                  AND id.invd_kode = d.sod_kode 
                  AND id.invd_ukuran = d.sod_ukuran
            ), 0)) AS 'Sisa Qty',

            d.sod_harga AS 'Harga',
            d.sod_diskon AS 'Diskon',
            (d.sod_jumlah * (d.sod_harga - d.sod_diskon)) AS 'Total Nilai SO'

        FROM tso_hdr h
        JOIN tso_dtl d ON h.so_nomor = d.sod_so_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
        LEFT JOIN tbarangdc a ON a.brg_kode = d.sod_kode
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.sod_kode
        
        WHERE DATE(h.so_tanggal) BETWEEN ? AND ? 
        ${branchFilter}
        ${searchFilter}
        ${statusClause} -- Filter status "Open" masuk sini
        
        ORDER BY h.so_nomor, d.sod_nourut;
    `;

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * @description Menyusuri jejak (tracking) Surat Pesanan dari hulu ke hilir beserta rincian item
 */
const trackOrderTimeline = async (nomorSO) => {
  const connection = await pool.getConnection();
  try {
    const timeline = [];
    let milestoneId = 1;

    // Helper untuk menebak jenis order dari Prefix
    const getJenisProduksi = (nomorDtf) => {
      if (!nomorDtf) return "Produksi";
      const parts = nomorDtf.split(".");
      if (parts.length < 2) return "Produksi";
      const prefix = parts[1].toUpperCase();
      switch (prefix) {
        case "SD":
          return "SABLON DTF";
        case "BR":
          return "BORDIR";
        case "PL":
          return "POLYFLEX";
        case "DP":
          return "DTF PREMIUM";
        case "SB":
          return "SABLON MANUAL";
        default:
          return "PRODUKSI";
      }
    };

    // ==========================================
    // 1. CEK SURAT PESANAN (SO) & CUSTOMER
    // ==========================================
    const [soRows] = await connection.query(
      `SELECT h.so_nomor, h.so_tanggal, h.so_pen_nomor, h.date_create, h.user_create, h.so_close, 
              c.cus_nama, h.so_disc, h.so_ppn, h.so_bkrm, h.so_dp 
       FROM tso_hdr h 
       LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
       WHERE h.so_nomor = ? LIMIT 1`,
      [nomorSO],
    );

    if (soRows.length === 0) throw new Error("Surat Pesanan tidak ditemukan.");
    const so = soRows[0];

    // ==========================================
    // 2. AMBIL DETAIL ITEM PESANAN (Baju / Produk)
    // ==========================================
    const [detailRows] = await connection.query(
      `SELECT d.sod_kode, d.sod_ukuran, d.sod_jumlah, d.sod_harga, d.sod_diskon,
              d.sod_sd_nomor, d.sod_custom, d.sod_custom_nama, d.sod_scanned, 
              TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), " ", IFNULL(a.brg_tipe,''), " ", IFNULL(a.brg_lengan,''), " ", IFNULL(a.brg_jeniskain,''), " ", IFNULL(a.brg_warna,''))) AS nama_normal,
              f.sd_nama AS nama_dtf
       FROM tso_dtl d
       LEFT JOIN tbarangdc a ON a.brg_kode = d.sod_kode
       LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.sod_sd_nomor
       WHERE d.sod_so_nomor = ? ORDER BY d.sod_nourut`,
      [nomorSO],
    );

    let totalBruto = 0;

    // Variabel penampung khusus untuk barang yang WAJIB SCAN
    let targetQtySO = 0;
    let targetQtyScanned = 0;

    const orderItems = detailRows.map((r) => {
      let namaBarang = r.nama_normal;
      if (r.sod_custom === "Y" && r.sod_custom_nama)
        namaBarang = r.sod_custom_nama;
      else if (r.nama_dtf) namaBarang = r.nama_dtf;

      const subtotal = r.sod_jumlah * (r.sod_harga - r.sod_diskon);
      totalBruto += subtotal;

      let imageUrl = "";
      if (r.sod_sd_nomor) {
        const cabang = r.sod_sd_nomor.substring(0, 3);
        imageUrl = `https://103.94.238.252/images/${cabang}/${r.sod_sd_nomor}.jpg`;
      }

      // --- LOGIKA MENGABAIKAN BARANG AUTO-READY (JASA/CUSTOM/DTF) ---
      const kodeUp = (r.sod_kode || "").toUpperCase();
      const namaUp = (namaBarang || "").toUpperCase();

      const isJasaMurni =
        kodeUp.startsWith("JASA") ||
        kodeUp.startsWith("JS") ||
        namaUp.includes("JASA") ||
        namaUp.includes("ONGKIR");
      const isSpecialOrder =
        kodeUp === "CUSTOM" ||
        r.sod_custom === "Y" ||
        (r.sod_sd_nomor && r.sod_sd_nomor.trim() !== "");

      // Jika BUKAN barang auto-ready, maka masuk ke hitungan Wajib Scan
      if (!isJasaMurni && !isSpecialOrder) {
        targetQtySO += Number(r.sod_jumlah || 0);
        targetQtyScanned += Number(r.sod_scanned || 0);
      }

      return {
        kode: r.sod_kode,
        nama: namaBarang,
        ukuran: r.sod_ukuran,
        qty: r.sod_jumlah,
        harga: r.sod_harga,
        diskon: r.sod_diskon,
        subtotal: subtotal,
        sd_nomor: r.sod_sd_nomor,
        imageUrl: imageUrl,
      };
    });

    const diskonFaktur = Number(so.so_disc || 0);
    const netto = totalBruto - diskonFaktur;
    const ppn = (Number(so.so_ppn || 0) / 100) * netto;
    const grandTotal = netto + ppn + Number(so.so_bkrm || 0);
    let totalDibayar = 0;
    let sisaTagihan = grandTotal;

    // ==========================================
    // 3. TRACKING LOG PENAWARAN, SO, & PEMBAYARAN DP
    // ==========================================
    if (so.so_pen_nomor) {
      const [penRows] = await connection.query(
        `SELECT pen_nomor, date_create, user_create FROM tpenawaran_hdr WHERE pen_nomor = ? LIMIT 1`,
        [so.so_pen_nomor],
      );
      if (penRows.length > 0) {
        timeline.push({
          id: milestoneId++,
          title: "Penawaran Harga Dibuat",
          subtitle: `Oleh: ${penRows[0].user_create}`,
          waktu: format(new Date(penRows[0].date_create), "dd-MM-yyyy HH:mm"),
          rawDate: new Date(penRows[0].date_create),
          status: "DONE",
          icon: "mdi-handshake",
          color: "grey",
          detail: `Ref: ${penRows[0].pen_nomor}`,
          stepOrder: 1,
        });
      }
    }

    timeline.push({
      id: milestoneId++,
      title: "Pesanan Dibuat (SO)",
      subtitle: `Oleh: ${so.user_create}`,
      waktu: format(new Date(so.date_create), "dd-MM-yyyy HH:mm"),
      rawDate: new Date(so.date_create),
      status: "DONE",
      icon: "mdi-file-document-edit",
      color: "blue",
      detail: `Nomor: ${so.so_nomor}`,
      stepOrder: 2,
    });

    const [dpRows] = await connection.query(
      `SELECT sh_nomor, sh_nominal, user_create, date_create FROM tsetor_hdr WHERE sh_so_nomor = ? AND sh_otomatis = 'N'`,
      [nomorSO],
    );
    // Kita gunakan variabel sementara untuk menghitung akumulasi *saat looping berjalan*
    let akumulasiLoop = 0;

    dpRows.forEach((row) => {
      const nominalSetor = Number(row.sh_nominal);
      akumulasiLoop += nominalSetor;
      totalDibayar += nominalSetor; // Update totalDibayar global yang sudah ada di service

      let titleDP = "Pembayaran Diterima (DP)";
      let colorDP = "grey";
      let iconDP = "mdi-cash";

      // Cek apakah dengan setoran ini, totalnya sudah mencapai grand total
      if (akumulasiLoop >= grandTotal && grandTotal > 0) {
        titleDP = "Pembayaran Diterima (LUNAS)";
        colorDP = "green-darken-2";
        iconDP = "mdi-cash-check";
      }

      timeline.push({
        id: milestoneId++,
        title: titleDP,
        subtitle: `Kasir: ${row.user_create}`,
        waktu: format(new Date(row.date_create), "dd-MM-yyyy HH:mm"),
        rawDate: new Date(row.date_create),
        status: "DONE",
        icon: iconDP,
        color: colorDP,
        detail: `Nominal: Rp ${nominalSetor.toLocaleString("id-ID")} (${row.sh_nomor})`,
        stepOrder: 3,
      });
    });

    sisaTagihan = grandTotal - totalDibayar;

    // ==========================================
    // 4A. TRACKING JASA INTERNAL (DTF/BORDIR/SABLON DLL)
    // ==========================================
    let jenisProduksiArr = [];
    let estimasiSelesai = null;

    // Pakai GROUP BY h.sd_nomor agar tidak ada log yang dobel
    const [dtfRows] = await connection.query(
      `SELECT h.sd_nomor, MIN(h.date_create) AS date_create, MAX(h.user_create) AS user_create, MAX(h.sd_alasan) AS sd_alasan, MAX(h.sd_cab) AS sd_cab 
       FROM tso_dtl d JOIN tsodtf_hdr h ON h.sd_nomor = d.sod_sd_nomor 
       WHERE d.sod_so_nomor = ? AND d.sod_sd_nomor IS NOT NULL AND d.sod_sd_nomor <> ''
       GROUP BY h.sd_nomor`,
      [nomorSO],
    );

    let hasDtf = dtfRows.length > 0;

    for (const dtf of dtfRows) {
      const jenisProd = getJenisProduksi(dtf.sd_nomor);
      if (!jenisProduksiArr.includes(jenisProd))
        jenisProduksiArr.push(jenisProd);

      // --- [BARU] LOGIKA ESTIMASI ---
      const tglMulai = new Date(dtf.date_create);
      let tglEstimasi = new Date(tglMulai);

      const prefix = dtf.sd_nomor.split(".")[1]?.toUpperCase();
      if (prefix === "SD") {
        tglEstimasi.setDate(tglMulai.getDate() + 3); // SD = 3 Hari
      } else if (prefix === "BR") {
        tglEstimasi.setDate(tglMulai.getDate() + 14); // BR = 2 Minggu
      }

      // Ambil tanggal terjauh jika ada beberapa jasa
      if (!estimasiSelesai || tglEstimasi > estimasiSelesai) {
        estimasiSelesai = tglEstimasi;
      }
      // -------------------------------

      timeline.push({
        id: milestoneId++,
        title: `Diteruskan ke Produksi (${jenisProd})`,
        subtitle: `Oleh: ${dtf.user_create}`,
        waktu: format(new Date(dtf.date_create), "dd-MM-yyyy HH:mm"),
        rawDate: new Date(dtf.date_create),
        status: "DONE",
        icon: "mdi-printer-3d-nozzle",
        color: "purple",
        detail: `Antrian: ${dtf.sd_nomor}`,
        stepOrder: 4,
      });

      // LHK KHUSUS K01 & K03
      let lhkQuery = `SELECT lhk_nomor, IFNULL(date_create, CONCAT(tanggal, ' 12:00:00')) AS date_create, user_create FROM tdtf WHERE TRIM(sodtf) = TRIM(?) ORDER BY date_create ASC LIMIT 1`;
      if (dtf.sd_cab === "K01" || dtf.sd_cab === "K03") {
        lhkQuery = `SELECT spk_nomor AS lhk_nomor, IFNULL(date_create, CONCAT(tanggal, ' 12:00:00')) AS date_create, user_create FROM kencanaprint.tdtf WHERE TRIM(spk_nomor) = TRIM(?) ORDER BY date_create ASC LIMIT 1`;
      }

      const [lhkRows] = await connection.query(lhkQuery, [dtf.sd_nomor]);

      if (lhkRows.length > 0) {
        const lhkDate = new Date(lhkRows[0].date_create);
        timeline.push({
          id: milestoneId++,
          title: `Proses ${jenisProd} Selesai (LHK)`,
          subtitle: `Mesin / Operator: ${lhkRows[0].user_create}`,
          waktu: format(lhkDate, "dd-MM-yyyy HH:mm"),
          rawDate: lhkDate,
          status: "DONE",
          icon: "mdi-printer-check",
          color: "orange",
          detail: `Ref LHK: ${lhkRows[0].lhk_nomor}`,
          stepOrder: 5,
        });
      } else {
        timeline.push({
          id: milestoneId++,
          title: `Menunggu Proses ${jenisProd}`,
          subtitle: "Belum masuk antrian mesin",
          waktu: "-",
          rawDate: new Date(new Date(dtf.date_create).getTime() + 1000),
          status: "ACTIVE",
          icon: "mdi-printer-alert",
          color: "orange",
          detail: `Antrian: ${dtf.sd_nomor}`,
          stepOrder: 5,
        });
      }
    }

    // ==========================================
    // 4B. TRACKING PRODUKSI PABRIK (SPK GARMEN)
    // ==========================================
    const [spkRows] = await connection.query(
      `SELECT spk_nomor, spk_nama, date_create FROM kencanaprint.tspk WHERE spk_invdc = ? AND spk_aktif = 'Y'`,
      [nomorSO],
    );
    let hasSpk = spkRows.length > 0;

    for (const spk of spkRows) {
      const jenisProd = "SPK PABRIK";
      if (!jenisProduksiArr.includes(jenisProd))
        jenisProduksiArr.push(jenisProd);

      let lastSpkActionDate = new Date(spk.date_create);
      let isMaterialRealized = false;
      let spkChildren = [];

      // --- [BARU] LOGIKA ESTIMASI SPK PABRIK (2 MINGGU) ---
      let tglEstimasiSpk = new Date(spk.date_create);
      tglEstimasiSpk.setDate(tglEstimasiSpk.getDate() + 14); // Tambah 14 Hari

      // Adu dengan estimasi DTF/Jasa (jika ada), ambil tanggal yang paling lama/jauh
      if (!estimasiSelesai || tglEstimasiSpk > estimasiSelesai) {
        estimasiSelesai = tglEstimasiSpk;
      }
      // ----------------------------------------------------

      // [4B.1] CEK PERMINTAAN BAHAN & REALISASI
      const [mintaRows] = await connection.query(
        `SELECT m.min_nomor, m.min_close, m.date_create as req_date, m.user_create as req_user, IFNULL((SELECT SUM(mind_jumlah) FROM kencanaprint.tmintabahan_dtl WHERE mind_nomor = m.min_nomor), 0) as req_qty FROM kencanaprint.tmintabahan_hdr m WHERE m.min_spk_nomor = ? ORDER BY m.date_create ASC`,
        [spk.spk_nomor],
      );

      if (mintaRows.length > 0) {
        for (const minta of mintaRows) {
          lastSpkActionDate = new Date(minta.req_date);
          spkChildren.push({
            id: milestoneId++,
            title: "Permintaan Bahan Dibuat",
            subtitle: `Oleh: ${minta.req_user}`,
            waktu: format(lastSpkActionDate, "dd-MM-yyyy HH:mm"),
            rawDate: lastSpkActionDate,
            status: "DONE",
            icon: "mdi-clipboard-text-outline",
            color: "blue-grey",
            detail: `Ref: ${minta.min_nomor} • Qty: ${minta.req_qty}`,
            stepOrder: 4.1,
          });

          const [realRows] = await connection.query(
            `SELECT p.promin_nomor, p.date_create as real_date, p.user_create as real_user, IFNULL((SELECT SUM(promind_Jumlah) FROM kencanaprint.tproduksiminta_dtl WHERE promind_promin_Nomor = p.promin_nomor), 0) as real_qty FROM kencanaprint.tproduksiminta_hdr p WHERE p.promin_minta = ? OR p.promin_spk_nomor = ? ORDER BY p.date_create DESC LIMIT 1`,
            [minta.min_nomor, spk.spk_nomor],
          );
          if (realRows.length > 0) {
            const real = realRows[0];
            lastSpkActionDate = new Date(real.real_date);
            isMaterialRealized = true;
            spkChildren.push({
              id: milestoneId++,
              title: "Bahan Dikeluarkan (Realisasi)",
              subtitle: `Gudang Bahan Baku • Oleh: ${real.real_user}`,
              waktu: format(lastSpkActionDate, "dd-MM-yyyy HH:mm"),
              rawDate: lastSpkActionDate,
              status: "DONE",
              icon: "mdi-package-up",
              color: "brown",
              detail: `Ref: ${real.promin_nomor} • Qty: ${real.real_qty}`,
              stepOrder: 4.2,
            });
          } else {
            if (
              minta.min_close === 0 ||
              minta.min_close === 2 ||
              minta.min_close === 1
            ) {
              spkChildren.push({
                id: milestoneId++,
                title: "Menunggu Pengeluaran Bahan",
                subtitle: "Bagian Gudang Bahan Baku",
                waktu: "Berjalan",
                rawDate: new Date(lastSpkActionDate.getTime() + 1000),
                status: "ACTIVE",
                icon: "mdi-timer-sand",
                color: "orange",
                detail: `Menunggu realisasi ${minta.min_nomor}`,
                stepOrder: 4.2,
              });
            } else if (minta.min_close === 9) {
              spkChildren.push({
                id: milestoneId++,
                title: "Permintaan Bahan Dibatalkan",
                subtitle: "Pesanan Dibatalkan / Close Manual",
                waktu: "-",
                rawDate: new Date(lastSpkActionDate.getTime() + 1000),
                status: "CANCEL",
                icon: "mdi-cancel",
                color: "red",
                detail: `Permintaan ${minta.min_nomor} ditutup`,
                stepOrder: 4.2,
              });
            }
          }
        }
      } else {
        spkChildren.push({
          id: milestoneId++,
          title: "Menunggu Permintaan Bahan",
          subtitle: "Tahap Persiapan Produksi",
          waktu: "Berjalan",
          rawDate: new Date(lastSpkActionDate.getTime() + 1000),
          status: "ACTIVE",
          icon: "mdi-clipboard-alert-outline",
          color: "orange",
          detail: `Untuk SPK: ${spk.spk_nomor}`,
          stepOrder: 4.1,
        });
      }

      // [4B.2] CEK MUTASI PRODUKSI (GROUP BY TANGGAL, GUDANG, & NAMA KOMPONEN DETAIL)
      const [mutasiRows] = await connection.query(
        `SELECT 
            h.mph_gdgasal, 
            DATE(h.date_create) AS tanggal_grup, 
            MAX(h.date_create) AS date_create, 
            MAX(h.user_create) AS user_create, 
            GROUP_CONCAT(DISTINCT h.mph_nomor SEPARATOR ', ') AS list_nomor, 
            IFNULL(NULLIF(d.mpd_nama, ''), 'Gabungan') AS nama_komponen, 
            IFNULL(SUM(d.mpd_jumlah), 0) AS qty 
         FROM kencanaprint.tmutasiproduksi_hdr h 
         LEFT JOIN kencanaprint.tmutasiproduksi_dtl d ON d.mpd_mph_nomor = h.mph_nomor AND d.mpd_spk = ? 
         WHERE h.mph_spk_nomor = ? AND h.mph_gdgasal IN ('GP001', 'GP002', 'GP003', 'GP004', 'GP013') 
         GROUP BY h.mph_gdgasal, DATE(h.date_create), d.mpd_nama 
         ORDER BY date_create ASC`,
        [spk.spk_nomor, spk.spk_nomor],
      );

      let lastGudangAsal = null;
      for (const mutasi of mutasiRows) {
        lastSpkActionDate = new Date(mutasi.date_create);
        lastGudangAsal = mutasi.mph_gdgasal;

        let mutasiTitle = "";
        let mutasiIcon = "mdi-factory";
        let mutasiOrder = 4.3;
        let mutasiColor = "blue-grey";

        // Memasukkan nama komponen ke dalam Judul
        const namaKomp =
          mutasi.nama_komponen !== "Gabungan"
            ? ` (${mutasi.nama_komponen})`
            : "";

        switch (mutasi.mph_gdgasal) {
          case "GP001":
            mutasiTitle = `Proses Potong Selesai${namaKomp}`;
            mutasiIcon = "mdi-content-cut";
            mutasiOrder = 4.3;
            mutasiColor = "teal";
            break;
          case "GP002":
            mutasiTitle = `Proses Cetak Selesai${namaKomp}`;
            mutasiIcon = "mdi-printer-3d-nozzle";
            mutasiOrder = 4.4;
            mutasiColor = "purple";
            break;
          case "GP003":
            mutasiTitle = `Proses Jahit Selesai${namaKomp}`;
            mutasiIcon = "mdi-tshirt-crew";
            mutasiOrder = 4.5;
            mutasiColor = "indigo";
            break;
          case "GP004":
            mutasiTitle = `Proses Lipat Selesai${namaKomp}`;
            mutasiIcon = "mdi-package-variant-closed";
            mutasiOrder = 4.6;
            mutasiColor = "brown";
            break;
          case "GP013":
            mutasiTitle = `Barang Jadi (Masuk Koli)${namaKomp}`;
            mutasiIcon = "mdi-check-decagram";
            mutasiOrder = 4.7;
            mutasiColor = "green-darken-2";
            break;
        }

        let refText = mutasi.list_nomor;

        spkChildren.push({
          id: milestoneId++,
          title: mutasiTitle,
          subtitle: `Gudang Asal: ${mutasi.mph_gdgasal} • Oleh: ${mutasi.user_create}`,
          waktu: format(lastSpkActionDate, "dd-MM-yyyy HH:mm"),
          rawDate: lastSpkActionDate,
          status: "DONE",
          icon: mutasiIcon,
          color: mutasiColor,
          detail: `Ref: ${refText} • Qty Komponen: ${mutasi.qty}`,
          stepOrder: mutasiOrder,
        });
      }

      // [4B.3] CEK STBJ DAN PENERIMAAN DC
      const [stbjRows] = await connection.query(
        `SELECT DISTINCT h.stbj_nomor, h.date_create, h.user_create, IFNULL((SELECT SUM(stbjd_jumlah) FROM kencanaprint.tstbj_dtl d2 WHERE d2.stbjd_stbj_nomor = h.stbj_nomor AND d2.stbjd_spk_nomor = ?), 0) AS qty_stbj 
         FROM kencanaprint.tstbj_hdr h JOIN kencanaprint.tstbj_dtl d ON d.stbjd_stbj_nomor = h.stbj_nomor 
         WHERE d.stbjd_spk_nomor = ? ORDER BY h.date_create ASC`,
        [spk.spk_nomor, spk.spk_nomor],
      );

      let isStbjDone = false;
      if (stbjRows.length > 0) {
        for (const stbj of stbjRows) {
          lastSpkActionDate = new Date(stbj.date_create);
          isStbjDone = true;
          spkChildren.push({
            id: milestoneId++,
            title: "Surat Terima Barang Jadi (STBJ)",
            subtitle: `Pabrik ke DC • Oleh: ${stbj.user_create}`,
            waktu: format(lastSpkActionDate, "dd-MM-yyyy HH:mm"),
            rawDate: lastSpkActionDate,
            status: "DONE",
            icon: "mdi-file-certificate-outline",
            color: "blue-darken-3",
            detail: `Ref: ${stbj.stbj_nomor} • Qty: ${stbj.qty_stbj}`,
            stepOrder: 4.8,
          });
        }

        const [terimaDcRows] = await connection.query(
          `SELECT DISTINCT h.ts_nomor, h.date_create, h.user_create, IFNULL((SELECT SUM(tsd_jumlah) FROM tdc_stbj_dtl d2 WHERE d2.tsd_nomor = h.ts_nomor AND d2.tsd_spk_nomor = ?), 0) AS qty_terima 
           FROM tdc_stbj_hdr h JOIN tdc_stbj_dtl d ON d.tsd_nomor = h.ts_nomor 
           WHERE d.tsd_spk_nomor = ? ORDER BY h.date_create ASC`,
          [spk.spk_nomor, spk.spk_nomor],
        );
        if (terimaDcRows.length > 0) {
          for (const terima of terimaDcRows) {
            lastSpkActionDate = new Date(terima.date_create);
            spkChildren.push({
              id: milestoneId++,
              title: "Barang Diterima DC",
              subtitle: `Gudang Pusat • Oleh: ${terima.user_create}`,
              waktu: format(lastSpkActionDate, "dd-MM-yyyy HH:mm"),
              rawDate: lastSpkActionDate,
              status: "DONE",
              icon: "mdi-store-check",
              color: "teal-darken-3",
              detail: `Ref: ${terima.ts_nomor} • Qty: ${terima.qty_terima}`,
              stepOrder: 4.9,
            });
          }
        } else {
          spkChildren.push({
            id: milestoneId++,
            title: "Menunggu Penerimaan DC",
            subtitle: "Proses Pengiriman Internal",
            waktu: "Berjalan",
            rawDate: new Date(lastSpkActionDate.getTime() + 1000),
            status: "ACTIVE",
            icon: "mdi-truck-fast-outline",
            color: "orange",
            detail: `Menunggu DC menerima STBJ`,
            stepOrder: 4.9,
          });
        }
      }

      // [4B.4] INJEKSI STATUS "MENUNGGU PROSES" DINAMIS
      if (isMaterialRealized && !isStbjDone) {
        let waitTitle = "";
        let waitIcon = "mdi-timer-sand";
        let waitOrder = 4.25;
        if (!lastGudangAsal) {
          waitTitle = "Menunggu Proses Potong";
          waitIcon = "mdi-content-cut";
          waitOrder = 4.25;
        } else if (lastGudangAsal === "GP001" || lastGudangAsal === "GP002") {
          waitTitle = "Menunggu Proses Jahit";
          waitIcon = "mdi-tshirt-crew";
          waitOrder = 4.45;
        } else if (lastGudangAsal === "GP003") {
          waitTitle = "Menunggu Proses Lipat";
          waitIcon = "mdi-package-variant-closed";
          waitOrder = 4.55;
        } else if (lastGudangAsal === "GP004") {
          waitTitle = "Menunggu Masuk Koli";
          waitIcon = "mdi-check-decagram";
          waitOrder = 4.65;
        } else if (lastGudangAsal === "GP013") {
          waitTitle = "Menunggu Pembuatan STBJ";
          waitIcon = "mdi-file-document-outline";
          waitOrder = 4.75;
        }

        if (waitTitle) {
          spkChildren.push({
            id: milestoneId++,
            title: waitTitle,
            subtitle: "Antrian Pabrik",
            waktu: "Berjalan",
            rawDate: new Date(lastSpkActionDate.getTime() + 1000),
            status: "ACTIVE",
            icon: waitIcon,
            color: "orange",
            detail: `Untuk SPK: ${spk.spk_nomor}`,
            stepOrder: waitOrder,
          });
        }
      }

      // [4B.5] PUSH PARENT SPK KE TIMELINE UTAMA (Sort descending di dalam children)
      spkChildren.sort((a, b) => {
        if (a.stepOrder !== b.stepOrder) return a.stepOrder - b.stepOrder;
        return a.rawDate.getTime() - b.rawDate.getTime();
      });

      timeline.push({
        id: milestoneId++,
        title: `Diteruskan ke Produksi (${jenisProd})`,
        subtitle: `Nama SPK: ${spk.spk_nama}`,
        waktu: format(new Date(spk.date_create), "dd-MM-yyyy HH:mm"),
        rawDate: new Date(spk.date_create),
        status: "DONE",
        icon: "mdi-factory",
        color: "brown-darken-2",
        detail: `No SPK: ${spk.spk_nomor}`,
        stepOrder: 4,
        isSpkGroup: true,
        children: spkChildren,
      });
    } // Akhir loop for (const spk of spkRows)

    // ==========================================
    // 5. TRACKING READY & INVOICE / PELUNASAN
    // ==========================================
    const [invRows] = await connection.query(
      `SELECT inv_nomor, date_create, user_create, inv_sts_pro FROM tinv_hdr WHERE inv_nomor_so = ? AND inv_sts_pro = 0 ORDER BY date_create DESC LIMIT 1`,
      [nomorSO],
    );

    // [PERBAIKAN]: Ambil nilai yang sudah difilter dari loop orderItems di atas
    // Tidak perlu lagi query SELECT SUM() ke database
    const qtySO = targetQtySO;
    const qtyScanned = targetQtyScanned;

    // Ambil data Mutasi Stok untuk mendapatkan Timestamp dan User yang nge-scan
    const [mutasiStokRows] = await connection.query(
      `SELECT mso_nomor, date_create, user_create 
       FROM tmutasistok_hdr 
       WHERE mso_so_nomor = ? 
       ORDER BY date_create DESC LIMIT 1`,
      [nomorSO],
    );

    let scanDate = new Date();
    let scannerName = "Sistem";

    if (mutasiStokRows.length > 0) {
      scanDate = new Date(mutasiStokRows[0].date_create);
      scannerName = mutasiStokRows[0].user_create;
    } else if (invRows.length > 0) {
      scanDate = new Date(new Date(invRows[0].date_create).getTime() - 60000);
    } else if (timeline.length > 0) {
      scanDate = new Date(
        timeline[timeline.length - 1].rawDate.getTime() + 60000,
      );
    }

    // Jika qtySO = 0 (Semua barang Auto Ready / Jasa), blok push ini otomatis di-skip
    if (qtyScanned >= qtySO && qtySO > 0) {
      timeline.push({
        id: milestoneId++,
        title: "Barang Ready (Scanned)",
        subtitle: `Siap diambil / dikirim • Oleh: ${scannerName}`,
        waktu: format(scanDate, "dd-MM-yyyy HH:mm"),
        rawDate: scanDate,
        status: "DONE",
        icon: "mdi-barcode-scan",
        color: "teal",
        detail: `Qty: ${qtyScanned} / ${qtySO}`,
        stepOrder: 6,
      });
    } else if (qtyScanned > 0) {
      timeline.push({
        id: milestoneId++,
        title: "Proses Scan Barang",
        subtitle: `Sebagian barang sudah siap • Oleh: ${scannerName}`,
        waktu: format(scanDate, "dd-MM-yyyy HH:mm"),
        rawDate: scanDate,
        status: "ACTIVE",
        icon: "mdi-barcode-scan",
        color: "teal",
        detail: `Scanned: ${qtyScanned} / ${qtySO}`,
        stepOrder: 6,
      });
    }

    if (invRows.length > 0) {
      const invNomor = invRows[0].inv_nomor;
      timeline.push({
        id: milestoneId++,
        title: "Invoice Dicetak / Diambil",
        subtitle: `Oleh: ${invRows[0].user_create}`,
        waktu: format(new Date(invRows[0].date_create), "dd-MM-yyyy HH:mm"),
        rawDate: new Date(invRows[0].date_create),
        status: "DONE",
        icon: "mdi-receipt-text",
        color: "green-darken-2",
        detail: `No. Invoice: ${invNomor}`,
        stepOrder: 8,
      });

      const [piutangRows] = await connection.query(
        `SELECT ph_nomor, ph_nominal FROM tpiutang_hdr WHERE ph_inv_nomor = ? LIMIT 1`,
        [invNomor],
      );
      if (piutangRows.length > 0) {
        const p = piutangRows[0];

        // Ambil riwayat pelunasan Invoice (selain DP)
        const [kreditRows] = await connection.query(
          `SELECT pd_tanggal, pd_kredit, pd_uraian, pd_ket FROM tpiutang_dtl WHERE pd_ph_nomor = ? AND pd_kredit > 0 AND pd_uraian != 'DP'`,
          [p.ph_nomor],
        );

        kreditRows.forEach((kr) => {
          if (kr.pd_uraian.includes("Pembulatan")) return;

          const nominalPelunasan = Number(kr.pd_kredit);

          // [PERBAIKAN PENTING]: Tambahkan ke totalDibayar GLOBAL agar sisa tagihan lunas!
          totalDibayar += nominalPelunasan;

          let titlePelunasan = "Pembayaran Tagihan";
          let colorPelunasan = "green";
          let iconPelunasan = "mdi-cash-multiple";

          // Cek apakah dengan pelunasan ini otomatis jadi lunas
          if (totalDibayar >= grandTotal && grandTotal > 0) {
            titlePelunasan = "Pembayaran Diterima (LUNAS)";
            colorPelunasan = "green-darken-2";
            iconPelunasan = "mdi-cash-check";
          }

          timeline.push({
            id: milestoneId++,
            title: titlePelunasan,
            subtitle: `Ket: ${kr.pd_uraian}`,
            waktu: format(new Date(kr.pd_tanggal), "dd-MM-yyyy HH:mm"),
            rawDate: new Date(kr.pd_tanggal),
            status: "DONE",
            icon: iconPelunasan,
            color: colorPelunasan,
            detail: `Nominal: Rp ${nominalPelunasan.toLocaleString("id-ID")}`,
            stepOrder: 7.5,
          });
        });
      }
    } else if (so.so_close === 2) {
      timeline.push({
        id: milestoneId++,
        title: "Pesanan Dibatalkan / Close Manual",
        subtitle: "Order ditutup tanpa Invoice",
        waktu: "-",
        rawDate: new Date(),
        status: "CANCEL",
        icon: "mdi-cancel",
        color: "red",
        stepOrder: 8,
      });
    }

    sisaTagihan = grandTotal - totalDibayar;

    const orderSummary = {
      totalBruto,
      diskonFaktur,
      ppn,
      biayaKirim: Number(so.so_bkrm || 0),
      grandTotal,
      totalDibayar: totalDibayar,
      sisaTagihan: sisaTagihan > 0 ? sisaTagihan : 0,
    };

    // Urutkan timeline lurus utama (Descending)
    timeline.sort((a, b) => {
      if (a.stepOrder !== b.stepOrder) return a.stepOrder - b.stepOrder;
      return a.rawDate.getTime() - b.rawDate.getTime();
    });
    timeline.reverse();

    const getWaktu = (keyword) => {
      const item = timeline.find(
        (t) =>
          t.title.includes(keyword) &&
          t.waktu !== "-" &&
          t.waktu !== "Lengkap" &&
          t.waktu !== "Berjalan",
      );
      return item ? item.waktu : null;
    };

    const jenisProduksiStr =
      jenisProduksiArr.length > 0 ? jenisProduksiArr.join(" + ") : "";
    const isProduksiActive = hasDtf || hasSpk;

    const milestones = [
      {
        id: 1,
        kode: "PENAWARAN",
        title: "Penawaran Dibuat",
        icon: "mdi-handshake",
        waktu: getWaktu("Penawaran"),
        isActive: timeline.some((t) => t.title.includes("Penawaran")),
        isCurrent: false,
      },
      {
        id: 2,
        kode: "SO",
        title: "SO Dibuat",
        icon: "mdi-cash-register",
        waktu: getWaktu("Pesanan"),
        isActive: timeline.some((t) => t.title.includes("Pesanan")),
        isCurrent: false,
      },
      {
        id: 3,
        kode: "PRODUKSI",
        title: "Sedang Diproses",
        icon: "mdi-factory",
        waktu:
          getWaktu("Diteruskan") ||
          getWaktu("Selesai (LHK)") ||
          getWaktu("Bahan") ||
          getWaktu("STBJ"),
        jenisProduksi: jenisProduksiStr,
        isActive: isProduksiActive,
        isCurrent: false,
      },
      {
        id: 4,
        kode: "READY",
        title: "Barang Selesai",
        icon: "mdi-package-check",
        waktu: getWaktu("Ready") || getWaktu("Diterima DC"),
        isActive: qtyScanned >= qtySO && qtySO > 0,
        isCurrent: false,
      },
      {
        id: 5,
        kode: "SELESAI",
        title: "Diambil / Invoice",
        icon: "mdi-truck-delivery-outline",
        waktu: getWaktu("Invoice"),
        isActive: invRows.length > 0 || so.so_close === 2,
        isCurrent: false,
      },
    ];

    if (invRows.length > 0 || so.so_close === 2) milestones[4].isCurrent = true;
    else if (qtyScanned >= qtySO && qtySO > 0) milestones[3].isCurrent = true;
    else if (isProduksiActive) milestones[2].isCurrent = true;
    else milestones[1].isCurrent = true;

    return {
      nomorSo: nomorSO,
      penerima: so.cus_nama || "Umum",
      resiAwb: so.so_nomor,
      milestones: milestones,
      logs: timeline,
      orderItems: orderItems,
      orderSummary: orderSummary,
      estimasiSelesai: estimasiSelesai
        ? format(estimasiSelesai, "dd MMMM yyyy")
        : null,
    };
  } finally {
    connection.release();
  }
};

/**
 * @description Mencari SO untuk Halaman Beranda Pelacakan dan mengelompokkan item
 */
const searchTrackingItems = async (nomorSO) => {
  const connection = await pool.getConnection();
  try {
    // 1. Cek Header SO
    const [soRows] = await connection.query(
      `SELECT h.so_nomor, h.so_tanggal, c.cus_nama 
       FROM tso_hdr h 
       LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode 
       WHERE h.so_nomor = ? LIMIT 1`,
      [nomorSO],
    );

    if (soRows.length === 0) {
      throw new Error("Nomor Surat Pesanan tidak ditemukan.");
    }

    // 2. Ambil dan Kelompokkan Detail Barang (Mengabaikan Ukuran), lalu cari SPK-nya
    const [itemRows] = await connection.query(
      `SELECT 
          TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), " ", IFNULL(a.brg_tipe,''), " ", IFNULL(a.brg_lengan,''), " ", IFNULL(a.brg_jeniskain,''), " ", IFNULL(a.brg_warna,''))) AS nama_barang,
          SUM(d.sod_jumlah) as total_qty,
          MAX((
              SELECT s.spkd_nomor 
              FROM kencanaprint.tspk_dc s 
              JOIN kencanaprint.tspk t ON t.spk_nomor = s.spkd_nomor 
              WHERE t.spk_invdc = d.sod_so_nomor AND s.spkd_kode = d.sod_kode 
              LIMIT 1
          )) as spk_nomor,
          MAX(d.sod_sd_nomor) as dtf_nomor
       FROM tso_dtl d
       LEFT JOIN tbarangdc a ON a.brg_kode = d.sod_kode
       WHERE d.sod_so_nomor = ?
       GROUP BY nama_barang`,
      [nomorSO],
    );

    // 3. Rapihkan data untuk ComboBox Frontend
    const formattedItems = itemRows.map((row, index) => {
      let labelNama = row.nama_barang || "Custom / Jasa";
      if (row.dtf_nomor) labelNama += ` (DTF)`;

      return {
        title: `${labelNama} - Total: ${row.total_qty} pcs`,
        // [PERBAIKAN]: Pakai nama barang atau index sebagai fallback agar value dijamin unik!
        value:
          row.spk_nomor || row.dtf_nomor || row.nama_barang || `UMUM_${index}`,
        namaBarang: labelNama,
        spk: row.spk_nomor,
        dtf: row.dtf_nomor,
      };
    });

    return {
      nomorSo: soRows[0].so_nomor,
      tanggal: soRows[0].so_tanggal,
      penerima: soRows[0].cus_nama || "Umum",
      items: formattedItems,
    };
  } finally {
    connection.release();
  }
};

/**
 * @description Mengambil promo aktif berdasarkan cabang dan tanggal
 */
const getActivePromos = async (filters) => {
  const connection = await pool.getConnection();
  try {
    const { tanggal, cabang } = filters;

    const promoQuery = `
      SELECT 
        p.pro_nomor,
        p.pro_judul,
        p.pro_totalrp,
        p.pro_totalqty,
        p.pro_disrp,
        p.pro_dispersen AS pro_diskon, 
        p.pro_rpvoucher,
        p.pro_lipat,
        p.pro_generate,
        p.pro_jenis,
        p.pro_tanggal1,
        p.pro_tanggal2,
        p.pro_f1,
        p.pro_jenis_kupon,
        p.pro_cetak_kupon,
        p.pro_keterangan,
        p.pro_note
      FROM tpromo p
      INNER JOIN tpromo_cabang c 
        ON c.pc_nomor = p.pro_nomor 
        AND c.pc_cab = ?
      WHERE p.pro_nomor <> 'PRO-2025-009' 
        AND ? BETWEEN p.pro_tanggal1 AND p.pro_tanggal2;
    `;

    const [activePromos] = await connection.query(promoQuery, [
      cabang,
      tanggal,
    ]);
    return activePromos;
  } finally {
    connection.release();
  }
};

module.exports = {
  getList,
  getCabangList,
  getDetails,
  getDataForPrint,
  close,
  remove,
  getExportDetails,
  trackOrderTimeline,
  searchTrackingItems,
  getActivePromos,
};
