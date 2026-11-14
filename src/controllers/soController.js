const soService = require("../services/soService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot
const jasaCustomTarif = require("../services/jasaCustomTarif");
const { rateLimit } = require("express-rate-limit");
const offerFormService = require("../services/offerFormService");
const { OnlineOfferError } = offerFormService;

const getAll = async (req, res) => {
  try {
    const data = await soService.getList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await soService.getDetails(nomor, req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getCabangList = async (req, res) => {
  try {
    const data = await soService.getCabangList(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const close = async (req, res) => {
  try {
    // Langsung eksekusi proses tanpa snapshot data lama
    const result = await soService.close({ ...req.body, user: req.user.kode });
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const remove = async (req, res) => {
  try {
    const { nomor } = req.params;

    // 1. SNAPSHOT: Ambil data lama LENGKAP sebelum dihapus
    let oldData = null;
    try {
      // A. Ambil Header
      const [headerRows] = await pool.query(
        "SELECT * FROM tso_hdr WHERE so_nomor = ?",
        [nomor],
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Ambil Detail (Gunakan sod_so_nomor)
        const [detailRows] = await pool.query(
          "SELECT * FROM tso_dtl WHERE sod_so_nomor = ? ORDER BY sod_nourut",
          [nomor],
        );

        // C. Gabungkan
        oldData = {
          ...header,
          items: detailRows,
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData remove SO:", e.message);
    }

    // 2. PROSES: Hapus data
    const result = await soService.remove(nomor, req.user);

    // 3. AUDIT: Catat Log Delete
    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE", // Action
        "SURAT_PESANAN", // Module
        nomor, // Target ID
        oldData, // Data Lama (Header + Items)
        null, // Data Baru
        `Menghapus SO Customer: ${oldData.so_cus_kode || "Unknown"}`,
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await soService.getDataForPrint(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getExportDetails = async (req, res) => {
  try {
    const data = await soService.getExportDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const trackOrder = async (req, res) => {
  try {
    const { nomor } = req.params;
    if (!nomor) {
      return res
        .status(400)
        .json({ message: "Nomor Surat Pesanan tidak valid." });
    }

    const data = await soService.trackOrderTimeline(nomor);
    res.json(data);
  } catch (error) {
    console.error("Error in trackOrder controller:", error);
    res.status(500).json({ message: "Gagal memuat jejak pesanan." });
  }
};

const searchTrackingItems = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await soService.searchTrackingItems(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getPublicActivePromos = async (req, res) => {
  try {
    // [FIX] Gunakan tanggal dari query jika ada, fallback ke tanggal WIB
    let tanggal = req.query.tanggal;

    if (!tanggal) {
      // Hitung tanggal lokal WIB (UTC+7) di sisi server
      const now = new Date();
      const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
      tanggal = wib.toISOString().split("T")[0];
    }

    const cabang = req.query.cabang || "K01";

    const data = await soService.getActivePromos({ tanggal, cabang });
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPublicStores = async (req, res) => {
  try {
    const data = await soService.getPublicStores();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPublicStock = async (req, res) => {
  try {
    const { cabang, q } = req.query;
    // Wajib ada cabang
    if (!cabang) return res.json([]);

    const data = await soService.getPublicStockLive(cabang, q || "");
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPublicContacts = async (req, res) => {
  try {
    const data = await soService.getPublicContacts();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPublicCatalog = async (req, res) => {
  try {
    res.json(await soService.getPublicCatalog());
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPublicTarifJasa = (req, res) => {
  // Tarif jarang berubah; 5 menit cukup dan meringankan server
  res.set("Cache-Control", "public, max-age=300");
  res.json(jasaCustomTarif.JASA_CUSTOM);
};

// ===== PENAWARAN ONLINE (publik, tanpa login) =====
// Urutan penjaga: limiter IP -> honeypot -> validasi -> Turnstile -> limiter telp/global -> simpan.
// Validasi sebelum Turnstile supaya token tidak terpakai bila input salah.
// Counter limiter ada di memori proses (pm2 fork tunggal): reset saat restart, itu disengaja.

const JAM = 60 * 60 * 1000;
const HARI = 24 * JAM;

const batas = (opsi) =>
  rateLimit({
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req, res) =>
      res
        .status(429)
        .json({ message: "Terlalu banyak percobaan. Coba lagi nanti." }),
    ...opsi,
  });

// Satu IP bisa dipakai banyak customer (Wi-Fi store), jadi batas IP sengaja longgar.
const limitIpJam = batas({ windowMs: JAM, limit: 10 });
const limitIpHari = batas({ windowMs: HARI, limit: 40 });
// Hanya permintaan sukses yang dihitung (skipFailedRequests), supaya salah isi tidak menghabiskan jatah.
const limitTelp = batas({
  windowMs: HARI,
  limit: 3,
  skipFailedRequests: true,
  keyGenerator: (req) => req.penawaranTelp,
});
const limitGlobal = batas({
  windowMs: HARI,
  limit: 300,
  skipFailedRequests: true,
  keyGenerator: () => "global",
});

const kirimErrorOnline = (res, err) => {
  if (err instanceof OnlineOfferError) {
    return res.status(err.status).json({ message: err.message });
  }
  // Jangan log err.message / sqlMessage: berisi nilai input (nama, telepon) dari customer.
  console.error(
    "[penawaran-online]",
    err && err.name,
    err && err.code,
    String((err && err.stack) || "")
      .split("\n")
      .slice(1, 4)
      .join(" | "),
  );
  return res
    .status(500)
    .json({ message: "Terjadi kesalahan di server. Coba lagi sebentar lagi." });
};

const tolakHoneypot = (req, res, next) => {
  const w = req.body && req.body.website;
  if (w !== undefined && w !== "") {
    return res.status(400).json({
      message: "Permintaan tidak valid. Muat ulang halaman lalu coba lagi.",
    });
  }
  next();
};

const validasiPenawaran = (req, res, next) => {
  try {
    const input = offerFormService.normalizeOnlineOfferInput(req.body);
    req.penawaranTelp = input.customer.telp;
    next();
  } catch (err) {
    return kirimErrorOnline(res, err);
  }
};

const TURNSTILE_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const cekTurnstile = async (req, res, next) => {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) {
    // Fail-closed: tanpa secret, endpoint tidak boleh terbuka tanpa captcha.
    console.error("[penawaran-online] TURNSTILE_SECRET belum diset");
    return res
      .status(503)
      .json({ message: "Layanan penawaran online sedang tidak tersedia." });
  }
  const token = req.body && req.body.turnstile;
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) {
    return res.status(400).json({
      message:
        "Verifikasi keamanan belum selesai. Muat ulang halaman lalu coba lagi.",
    });
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const params = new URLSearchParams({ secret, response: token });
    if (req.ip) params.set("remoteip", req.ip);
    const r = await fetch(TURNSTILE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: ctl.signal,
    });
    const data = await r.json();
    if (data && data.success === true) return next();
    return res.status(400).json({
      message: "Verifikasi keamanan gagal. Muat ulang halaman lalu coba lagi.",
    });
  } catch (err) {
    console.error(
      "[penawaran-online] Turnstile tidak terjangkau:",
      err && err.name,
    );
    return res.status(503).json({
      message:
        "Verifikasi keamanan sedang bermasalah. Coba lagi sebentar lagi.",
    });
  } finally {
    clearTimeout(timer);
  }
};

// Pool koneksi (10) dibagi dengan ERP: batasi penulisan yang berjalan bersamaan.
const MAKS_BERSAMAAN = 5;
let sedangDiproses = 0;
const telpDiproses = new Set();

const simpanPenawaranPublik = async (req, res) => {
  const telp = req.penawaranTelp;
  if (telpDiproses.has(telp)) {
    return res.status(429).json({
      message: "Penawaran sebelumnya masih diproses. Tunggu sebentar.",
    });
  }
  if (sedangDiproses >= MAKS_BERSAMAAN) {
    res.set("Retry-After", "5");
    return res
      .status(503)
      .json({ message: "Server sedang sibuk. Coba lagi sebentar lagi." });
  }
  telpDiproses.add(telp);
  sedangDiproses++;
  try {
    const hasil = await offerFormService.saveOnlineOffer(req.body);
    res.set("Cache-Control", "no-store");
    return res.status(201).json(hasil);
  } catch (err) {
    return kirimErrorOnline(res, err);
  } finally {
    telpDiproses.delete(telp);
    sedangDiproses--;
  }
};

// Rantai middleware untuk route POST (Express menerima array handler)
const postPublicPenawaran = [
  limitIpJam,
  limitIpHari,
  tolakHoneypot,
  validasiPenawaran,
  cekTurnstile,
  limitTelp,
  limitGlobal,
  simpanPenawaranPublik,
];

module.exports = {
  getAll,
  getDetails,
  getCabangList,
  close,
  remove,
  getPrintData,
  getExportDetails,
  trackOrder,
  searchTrackingItems,
  getPublicActivePromos,
  getPublicStores,
  getPublicStock,
  getPublicContacts,
  getPublicCatalog,
  getPublicTarifJasa,
  postPublicPenawaran,
};
