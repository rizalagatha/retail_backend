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

// =========================================================================
// B. STATUS TRACKING (tidak berubah dari sebelumnya — query ringkas,
// bukan duplikasi logic kompleks, aman ditulis manual)
// =========================================================================

const getSoBelumInvoice = async (user, filters = {}) => {
  const { cabang = "ALL", minUmurHari = 1 } = filters;
  let branchFilter = "";
  const params = [];

  if (user.cabang !== "KDC") {
    branchFilter = "AND h.so_cab = ?";
    params.push(user.cabang);
  } else if (cabang !== "ALL") {
    branchFilter = "AND h.so_cab = ?";
    params.push(cabang);
  }

  const query = `
    SELECT 
      h.so_nomor, DATE_FORMAT(h.so_tanggal, '%Y-%m-%d') AS tanggal_so, h.so_cab,
      IFNULL(c.cus_nama, '-') AS customer,
      DATEDIFF(CURDATE(), h.so_tanggal) AS umur_hari,
      IFNULL(scan.total_jumlah, 0) AS total_qty,
      IFNULL(scan.total_scanned, 0) AS total_scanned
    FROM tso_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
    LEFT JOIN (
      SELECT sod_so_nomor, SUM(sod_jumlah) AS total_jumlah, SUM(sod_scanned) AS total_scanned
      FROM tso_dtl GROUP BY sod_so_nomor
    ) scan ON scan.sod_so_nomor = h.so_nomor
    WHERE h.so_close = 0 AND h.so_aktif = 'Y'
      AND scan.total_jumlah > 0 AND scan.total_scanned >= scan.total_jumlah
      AND NOT EXISTS (SELECT 1 FROM tinv_hdr inv WHERE inv.inv_nomor_so = h.so_nomor AND inv.inv_sts_pro = 0)
      AND DATEDIFF(CURDATE(), h.so_tanggal) >= ?
      ${branchFilter}
    ORDER BY umur_hari DESC LIMIT 30;
  `;
  const [rows] = await pool.query(query, [minUmurHari, ...params]);
  return rows;
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
              IFNULL(c.cus_nama,'-') AS customer
       FROM tso_hdr h LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
       WHERE h.so_nomor = ?`,
      [cleanNomor],
    );
    return { found: true, type: "SO", header: soHeader[0], items: soItems };
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
  getPenawaranBelumFollowup,
  lookupDocument,
  trackOrderSummary, // [BARU]
  getConversionFunnel,
};
