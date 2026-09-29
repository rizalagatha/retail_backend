const pool = require("../config/database");
const { format, subDays } = require("date-fns");

// [PENTING] Sengaja destructure cuma fungsi READ-ONLY. JANGAN PERNAH
// tambahkan close/remove/deleteOffer/closeOffer ke sini — itu fungsi
// write-path yang bisa mengubah/menghapus data, tidak boleh bisa dipicu
// dari konteks AI dengan alasan apapun.
const { getDetails: getSoDetails, trackOrderTimeline } = require("./soService");
const { getOfferDetails } = require("./offerService");

const NAMA_BARANG_SQL = `TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), ' ', IFNULL(a.brg_tipe,''), ' ', IFNULL(a.brg_lengan,''), ' ', IFNULL(a.brg_jeniskain,''), ' ', IFNULL(a.brg_warna,'')))`;

// Helper: cek apakah user boleh akses dokumen berdasarkan prefix cabang di
// nomor dokumen (pola sama seperti soService.remove yang sudah ada).
const cekAksesCabang = (user, nomorDokumen) => {
  const cabangDariNomor = nomorDokumen.substring(0, 3);
  if (user.cabang !== "KDC" && cabangDariNomor !== user.cabang) {
    return false;
  }
  return true;
};

const clampLimit = (limit, def = 15) =>
  Math.min(50, Math.max(1, Number(limit) || def));

// Filter cabang sesuai hak akses user. Mengisi params sesuai urutan "?" di SQL.
const buildBranchFilter = (user, cabang, column, params) => {
  if (user.cabang !== "KDC") {
    params.push(user.cabang);
    return `AND ${column} = ?`;
  }
  if (cabang && cabang !== "ALL") {
    params.push(cabang);
    return `AND ${column} = ?`;
  }
  return "";
};

// Rumus nominal SO sama dengan soService.getList:
// (subtotal - diskon faktur) + PPN + biaya kirim
const hitungNominalSo = ({ subtotal, so_disc, so_ppn, so_bkrm }) => {
  const netto = (Number(subtotal) || 0) - (Number(so_disc) || 0);
  const ppn = ((Number(so_ppn) || 0) / 100) * netto;
  return Math.round(netto + ppn + (Number(so_bkrm) || 0));
};

const ringkasSoRows = (rows) => {
  const n = rows.length;
  const umur = rows.map((r) => Number(r.umur_hari) || 0);
  return {
    jumlahSO: n,
    totalNominal: rows.reduce((s, r) => s + (r.nominal || 0), 0),
    rataRataUmurHari: n
      ? Number((umur.reduce((a, b) => a + b, 0) / n).toFixed(1))
      : 0,
    umurTertuaHari: n ? Math.max(...umur) : 0,
    sebaranUmur: {
      sampai7Hari: umur.filter((u) => u <= 7).length,
      hari8sd30: umur.filter((u) => u > 7 && u <= 30).length,
      hari31sd90: umur.filter((u) => u > 30 && u <= 90).length,
      lebih90Hari: umur.filter((u) => u > 90).length,
    },
  };
};

const labelTahapSo = (r) => {
  const fisik = Number(r.qty_fisik) || 0;
  const scanned = Number(r.qty_scanned) || 0;
  if (Number(r.qty_invoice) > 0) return "Sebagian sudah diinvoice";
  if (fisik === 0) return "Order custom/jasa, belum diinvoice";
  if (scanned >= fisik) return "Barang siap, belum diinvoice";
  if (scanned > 0) return "Sebagian barang siap";
  return "Belum diproses";
};

const NON_FISIK_SQL = `(
  UPPER(d.sod_kode) LIKE 'JASA%' OR UPPER(d.sod_kode) LIKE 'JS%'
  OR d.sod_kode = 'CUSTOM' OR d.sod_custom = 'Y'
  OR (d.sod_sd_nomor IS NOT NULL AND d.sod_sd_nomor <> '')
)`;

/**
 * Semua SO yang masih "open" = belum ditutup manual, aktif, dan qty yang
 * sudah diinvoice masih kurang dari qty SO (definisi sama dengan status
 * bukan CLOSE/DICLOSE di halaman browse SO).
 */
const getOpenSoList = async (user, filters = {}) => {
  const {
    cabang = "ALL",
    search = "",
    minUmurHari = 0,
    sortBy = "umur",
    limit = 15,
  } = filters;

  const params = [];
  const branchFilter = buildBranchFilter(user, cabang, "h.so_cab", params);

  let searchFilter = "";
  const keyword = String(search || "").trim();
  if (keyword) {
    searchFilter = "AND (h.so_nomor LIKE ? OR c.cus_nama LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  params.push(Number(minUmurHari) || 0);

  const query = `
    SELECT * FROM (
      SELECT 
        h.so_nomor,
        DATE_FORMAT(h.so_tanggal, '%Y-%m-%d') AS tanggal_so,
        DATE_FORMAT(h.so_dateline, '%Y-%m-%d') AS dateline,
        h.so_cab, h.so_dp, h.so_disc, h.so_ppn, h.so_bkrm,
        IFNULL(c.cus_nama, '-') AS customer,
        DATEDIFF(CURDATE(), h.so_tanggal) AS umur_hari,
        IF(h.so_dateline IS NULL, 0, GREATEST(DATEDIFF(CURDATE(), h.so_dateline), 0)) AS telat_dateline_hari,
        IFNULL((SELECT SUM(d.sod_jumlah) FROM tso_dtl d WHERE d.sod_so_nomor = h.so_nomor), 0) AS qty_so,
        IFNULL((SELECT SUM(d.sod_jumlah * (d.sod_harga - d.sod_diskon)) FROM tso_dtl d WHERE d.sod_so_nomor = h.so_nomor), 0) AS subtotal,
        IFNULL((SELECT SUM(d.sod_jumlah) FROM tso_dtl d WHERE d.sod_so_nomor = h.so_nomor AND NOT ${NON_FISIK_SQL}), 0) AS qty_fisik,
        IFNULL((SELECT SUM(d.sod_scanned) FROM tso_dtl d WHERE d.sod_so_nomor = h.so_nomor AND NOT ${NON_FISIK_SQL}), 0) AS qty_scanned,
        IFNULL((
          SELECT SUM(i.invd_jumlah)
          FROM tinv_hdr j JOIN tinv_dtl i ON i.invd_inv_nomor = j.inv_nomor
          WHERE j.inv_sts_pro = 0 AND j.inv_nomor_so = h.so_nomor
            AND i.invd_kode NOT IN (SELECT brg_kode FROM kencanaprint.tgarmen_brg WHERE brg_jenis IN ('ACCESORIES','OBAT'))
        ), 0) AS qty_invoice
      FROM tso_hdr h
      LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
      WHERE h.so_close = 0 AND h.so_aktif = 'Y'
        ${branchFilter}
        ${searchFilter}
        AND DATEDIFF(CURDATE(), h.so_tanggal) >= ?
    ) x
    WHERE x.qty_so > x.qty_invoice
    ORDER BY x.umur_hari DESC
    LIMIT 500;
  `;
  const [rows] = await pool.query(query, params);

  const enriched = rows.map((r) => ({
    so_nomor: r.so_nomor,
    tanggal_so: r.tanggal_so,
    dateline: r.dateline,
    cabang: r.so_cab,
    customer: r.customer,
    umur_hari: Number(r.umur_hari) || 0,
    telat_dateline_hari: Number(r.telat_dateline_hari) || 0,
    qty_so: Number(r.qty_so) || 0,
    qty_sudah_diinvoice: Number(r.qty_invoice) || 0,
    qty_sisa: (Number(r.qty_so) || 0) - (Number(r.qty_invoice) || 0),
    nominal: hitungNominalSo(r),
    dp: Number(r.so_dp) || 0,
    tahap: labelTahapSo(r),
  }));

  if (sortBy === "nominal") enriched.sort((a, b) => b.nominal - a.nominal);

  const safeLimit = clampLimit(limit);
  const ringkasan = ringkasSoRows(enriched);
  ringkasan.jumlahLewatDateline = enriched.filter(
    (r) => r.telat_dateline_hari > 0,
  ).length;
  ringkasan.mungkinTerpotong = rows.length >= 500;

  return {
    ringkasan,
    urutan: sortBy === "nominal" ? "nominal terbesar" : "umur tertua",
    tampilkan: Math.min(safeLimit, enriched.length),
    data: enriched.slice(0, safeLimit),
  };
};

// =========================================================================
// B. STATUS TRACKING (tidak berubah dari sebelumnya — query ringkas,
// bukan duplikasi logic kompleks, aman ditulis manual)
// =========================================================================

const getSoBelumInvoice = async (user, filters = {}) => {
  const { cabang = "ALL", minUmurHari = 1, limit = 15 } = filters;
  const params = [];
  const branchFilter = buildBranchFilter(user, cabang, "h.so_cab", params);
  params.push(Number(minUmurHari) || 0);

  const query = `
    SELECT 
      h.so_nomor, DATE_FORMAT(h.so_tanggal, '%Y-%m-%d') AS tanggal_so, h.so_cab,
      IFNULL(c.cus_nama, '-') AS customer,
      DATEDIFF(CURDATE(), h.so_tanggal) AS umur_hari,
      IFNULL(scan.total_jumlah, 0) AS total_qty,
      IFNULL(scan.total_scanned, 0) AS total_scanned,
      IFNULL(scan.subtotal, 0) AS subtotal,
      h.so_disc, h.so_ppn, h.so_bkrm, h.so_dp
    FROM tso_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
    LEFT JOIN (
      SELECT sod_so_nomor,
             SUM(sod_jumlah) AS total_jumlah,
             SUM(sod_scanned) AS total_scanned,
             SUM(sod_jumlah * (sod_harga - sod_diskon)) AS subtotal
      FROM tso_dtl GROUP BY sod_so_nomor
    ) scan ON scan.sod_so_nomor = h.so_nomor
    WHERE h.so_close = 0 AND h.so_aktif = 'Y'
      AND scan.total_jumlah > 0 AND scan.total_scanned >= scan.total_jumlah
      AND NOT EXISTS (SELECT 1 FROM tinv_hdr inv WHERE inv.inv_nomor_so = h.so_nomor AND inv.inv_sts_pro = 0)
      ${branchFilter}
      AND DATEDIFF(CURDATE(), h.so_tanggal) >= ?
    ORDER BY umur_hari DESC LIMIT 500;
  `;
  const [rows] = await pool.query(query, params);

  const enriched = rows.map((r) => ({
    so_nomor: r.so_nomor,
    tanggal_so: r.tanggal_so,
    cabang: r.so_cab,
    customer: r.customer,
    umur_hari: Number(r.umur_hari) || 0,
    total_qty: Number(r.total_qty) || 0,
    total_scanned: Number(r.total_scanned) || 0,
    nominal: hitungNominalSo(r),
    dp: Number(r.so_dp) || 0,
  }));

  const safeLimit = clampLimit(limit);
  return {
    ringkasan: ringkasSoRows(enriched),
    tampilkan: Math.min(safeLimit, enriched.length),
    data: enriched.slice(0, safeLimit),
  };
};

const getPenawaranBelumFollowup = async (user, filters = {}) => {
  const { cabang = "ALL", minUmurHari = 7 } = filters;
  let branchFilter = "";
  const params = [];

  if (user.cabang !== "KDC") {
    branchFilter = "AND h.pen_cab = ?";
    params.push(user.cabang);
  } else if (cabang !== "ALL") {
    branchFilter = "AND h.pen_cab = ?";
    params.push(cabang);
  }

  const query = `
    SELECT h.pen_nomor, DATE_FORMAT(h.pen_tanggal, '%Y-%m-%d') AS tanggal, h.pen_cab,
      DATEDIFF(CURDATE(), h.pen_tanggal) AS umur_hari
    FROM tpenawaran_hdr h
    WHERE NOT EXISTS (SELECT 1 FROM tso_hdr so WHERE so.so_pen_nomor = h.pen_nomor)
      AND (h.pen_alasan IS NULL OR h.pen_alasan = '')
      AND DATEDIFF(CURDATE(), h.pen_tanggal) >= ?
      ${branchFilter}
    ORDER BY umur_hari DESC LIMIT 30;
  `;
  const [rows] = await pool.query(query, [minUmurHari, ...params]);
  return rows;
};

// =========================================================================
// A. LOOKUP DOKUMEN — sekarang reuse fungsi read-only yang sudah ada,
// bukan nulis SQL sendiri dari nol.
// =========================================================================

const lookupDocument = async (user, nomor) => {
  if (!nomor || !nomor.trim()) {
    return { found: false, message: "Nomor dokumen tidak boleh kosong." };
  }
  const cleanNomor = nomor.trim().toUpperCase();

  if (!cekAksesCabang(user, cleanNomor)) {
    return {
      found: false,
      message: "Kakak tidak punya akses ke dokumen cabang lain.",
    };
  }

  // Coba SO dulu — reuse soService.getDetails (bukan nulis query sendiri)
  const soItems = await getSoDetails(cleanNomor);
  if (soItems.length > 0) {
    const [soHeader] = await pool.query(
      `SELECT h.so_nomor, DATE_FORMAT(h.so_tanggal,'%Y-%m-%d') AS tanggal,
              DATE_FORMAT(h.so_dateline,'%Y-%m-%d') AS dateline, h.so_close,
              DATEDIFF(CURDATE(), h.so_tanggal) AS umur_hari,
              h.so_dp, h.so_disc, h.so_ppn, h.so_bkrm,
              IFNULL(c.cus_nama,'-') AS customer
       FROM tso_hdr h LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
       WHERE h.so_nomor = ?`,
      [cleanNomor],
    );
    const h = soHeader[0] || {};
    const subtotal = soItems.reduce(
      (s, it) => s + (Number(it.TotalSO) || 0),
      0,
    );
    const MAX_ITEMS = 40;

    return {
      found: true,
      type: "SO",
      header: {
        so_nomor: h.so_nomor,
        tanggal: h.tanggal,
        dateline: h.dateline,
        umur_hari: Number(h.umur_hari) || 0,
        customer: h.customer,
        status: h.so_close === 2 ? "DICLOSE" : "AKTIF",
        nominal: hitungNominalSo({
          subtotal,
          so_disc: h.so_disc,
          so_ppn: h.so_ppn,
          so_bkrm: h.so_bkrm,
        }),
        dp: Number(h.so_dp) || 0,
      },
      totalBaris: soItems.length,
      catatan:
        soItems.length > MAX_ITEMS
          ? `Hanya ${MAX_ITEMS} baris pertama yang ditampilkan dari ${soItems.length}.`
          : undefined,
      items: soItems.slice(0, MAX_ITEMS).map((it) => ({
        kode: it.Kode,
        nama: it.Nama,
        ukuran: it.Ukuran,
        qty: it.QtySO,
        harga: it.Harga,
        total: it.TotalSO,
        qtyInvoice: it.QtyInvoice,
        belumJadiInvoice: it.BlmJadiInvoice,
      })),
    };
  }

  // Coba Invoice (belum ada invoiceService.js yang dikasih — masih query manual.
  // Kalau kamu punya file itu, kasih tau, nanti diganti reuse juga.)
  const [invHdr] = await pool.query(
    `SELECT h.inv_nomor, DATE_FORMAT(h.inv_tanggal,'%Y-%m-%d') AS tanggal,
            h.inv_nomor_so, IFNULL(c.cus_nama,'-') AS customer
     FROM tinv_hdr h LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
     WHERE h.inv_nomor = ? AND h.inv_sts_pro = 0`,
    [cleanNomor],
  );
  if (invHdr.length > 0) {
    const [items] = await pool.query(
      `SELECT ${NAMA_BARANG_SQL} AS nama, d.invd_ukuran, d.invd_jumlah, d.invd_harga
       FROM tinv_dtl d LEFT JOIN tbarangdc a ON a.brg_kode = d.invd_kode
       WHERE d.invd_inv_nomor = ?`,
      [cleanNomor],
    );
    return { found: true, type: "INVOICE", header: invHdr[0], items };
  }

  // Coba Penawaran — reuse offerService.getOfferDetails
  const penItems = await getOfferDetails(cleanNomor);
  if (penItems.length > 0) {
    const [penHeader] = await pool.query(
      `SELECT pen_nomor, DATE_FORMAT(pen_tanggal,'%Y-%m-%d') AS tanggal, pen_alasan
       FROM tpenawaran_hdr WHERE pen_nomor = ?`,
      [cleanNomor],
    );
    return {
      found: true,
      type: "PENAWARAN",
      header: penHeader[0],
      items: penItems,
    };
  }

  return { found: false, message: `Dokumen "${cleanNomor}" tidak ditemukan.` };
};

// =========================================================================
// [BARU] Full journey/timeline 1 SO — reuse trackOrderTimeline APA ADANYA
// (logic-nya sudah kompleks & battle-tested buat halaman tracking customer).
// Cuma dipangkas field UI-nya (icon/color/id) biar hemat token buat Claude.
// =========================================================================

const trackOrderSummary = async (user, nomorSO) => {
  if (!nomorSO || !nomorSO.trim()) {
    return { found: false, message: "Nomor SO tidak boleh kosong." };
  }
  const cleanNomor = nomorSO.trim().toUpperCase();

  if (!cekAksesCabang(user, cleanNomor)) {
    return {
      found: false,
      message: "Kakak tidak punya akses ke dokumen cabang lain.",
    };
  }

  let result;
  try {
    result = await trackOrderTimeline(cleanNomor);
  } catch (err) {
    return {
      found: false,
      message: err.message || `SO "${cleanNomor}" tidak ditemukan.`,
    };
  }

  // [FIX] Sebelumnya cuma ambil 5 field top-level per entry timeline, jadi
  // detail tahap produksi (potong/jahit/lipat/koli per komponen) yang
  // tersimpan di `l.children` (khusus entry SPK, lihat isSpkGroup di
  // soService.trackOrderTimeline) IKUT TERBUANG sebelum sempat sampai ke
  // Claude — Claude jadi jujur bilang "tidak tersedia" padahal datanya
  // ada, cuma terpotong di layer ini. Sekarang children di-flatten masuk
  // ke urutan log yang sama, ditandai lewat field "tahapProduksi" biar
  // Claude bisa mengenali ini sebagai sub-tahap dari entry SPK induknya.
  const trimmedLogs = [];
  result.logs.forEach((l) => {
    trimmedLogs.push({
      title: l.title,
      subtitle: l.subtitle,
      waktu: l.waktu,
      detail: l.detail,
      status: l.status,
    });

    if (l.isSpkGroup && Array.isArray(l.children) && l.children.length > 0) {
      // children sudah terurut ASC (rawDate.getTime()) dari sumbernya —
      // pertahankan urutan itu apa adanya, jangan di-reverse lagi
      l.children.forEach((child) => {
        trimmedLogs.push({
          title: child.title,
          subtitle: child.subtitle,
          waktu: child.waktu,
          detail: child.detail,
          status: child.status,
          tahapProduksi: true, // [BARU] penanda ini sub-tahap dari SPK produksi
        });
      });
    }
  });

  return {
    found: true,
    nomorSo: result.nomorSo,
    penerima: result.penerima,
    milestoneSaatIni: result.milestones.find((m) => m.isCurrent)?.title || null,
    datelineCustomer: result.datelineCustomer,
    estimasiSelesai: result.estimasiSelesai,
    ringkasanPembayaran: result.orderSummary,
    barangDipesan: result.orderItems.map((it) => ({
      nama: it.nama,
      ukuran: it.ukuran,
      qty: it.qty,
      sudahScan: it.isFullyScanned,
    })),
    riwayat: trimmedLogs,
  };
};

// =========================================================================
// C. FUNNEL KONVERSI (tidak berubah)
// =========================================================================

const getConversionFunnel = async (user, filters = {}) => {
  const { cabang = "ALL", startDate, endDate } = filters;
  const start = startDate || format(subDays(new Date(), 30), "yyyy-MM-dd");
  const end = endDate || format(new Date(), "yyyy-MM-dd");

  let branchFilter = "";
  const params = [start, end];
  if (user.cabang !== "KDC") {
    branchFilter = "AND h.pen_cab = ?";
    params.push(user.cabang);
  } else if (cabang !== "ALL") {
    branchFilter = "AND h.pen_cab = ?";
    params.push(cabang);
  }

  const query = `
    SELECT 
      COUNT(DISTINCT h.pen_nomor) AS total_penawaran,
      COUNT(DISTINCT so.so_nomor) AS total_jadi_so,
      COUNT(DISTINCT inv.inv_nomor) AS total_jadi_invoice,
      ROUND(AVG(NULLIF(DATEDIFF(so.so_tanggal, h.pen_tanggal), 0)), 1) AS avg_hari_pen_ke_so,
      ROUND(AVG(NULLIF(DATEDIFF(inv.inv_tanggal, so.so_tanggal), 0)), 1) AS avg_hari_so_ke_invoice
    FROM tpenawaran_hdr h
    LEFT JOIN tso_hdr so ON so.so_pen_nomor = h.pen_nomor
    LEFT JOIN tinv_hdr inv ON inv.inv_nomor_so = so.so_nomor AND inv.inv_sts_pro = 0
    WHERE h.pen_tanggal BETWEEN ? AND ? ${branchFilter};
  `;
  const [rows] = await pool.query(query, params);
  const r = rows[0];
  const totalPenawaran = Number(r.total_penawaran) || 0;
  const totalJadiSo = Number(r.total_jadi_so) || 0;
  const totalJadiInvoice = Number(r.total_jadi_invoice) || 0;

  return {
    totalPenawaran,
    totalJadiSo,
    totalJadiInvoice,
    conversionRatePenawaranKeSo:
      totalPenawaran > 0
        ? Number(((totalJadiSo / totalPenawaran) * 100).toFixed(1))
        : 0,
    conversionRateSoKeInvoice:
      totalJadiSo > 0
        ? Number(((totalJadiInvoice / totalJadiSo) * 100).toFixed(1))
        : 0,
    avgHariPenawaranKeSo: Number(r.avg_hari_pen_ke_so) || 0,
    avgHariSoKeInvoice: Number(r.avg_hari_so_ke_invoice) || 0,
  };
};

module.exports = {
  getSoBelumInvoice,
  getOpenSoList,
  getPenawaranBelumFollowup,
  lookupDocument,
  trackOrderSummary,
  getConversionFunnel,
};
