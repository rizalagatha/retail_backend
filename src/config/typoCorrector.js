const Fuse = require("fuse.js");
const pool = require("../config/database");

// Variabel global untuk menyimpan data di RAM (in-memory cache)
let fuseInstance = null;

// TAHAP 1: Alias Manual (Tetap di-hardcode karena ini bahasa gaul/singkatan user)
const aliases = {
  lakos: "lacos",
  nevi: "navy/dongker",
  nepi: "navy/dongker",
  stiker: "sticker",
  aiar: "air",
  sby: "surabaya",
  pdk: "padokan",
  k06: "boyolali", // Bisa tambahkan kode cabang juga
};

// Fungsi untuk menarik data dari DB dan menginisialisasi Fuse.js
const initTypoCorrector = async () => {
  try {
    console.log("[TYPO CORRECTOR] Mengambil master data dari database...");

    // Sesuaikan nama tabel dengan yang ada di database-mu
    const [cabangRows] = await pool.query(
      `SELECT gdg_nama FROM tgudang WHERE gdg_dc = '0'`,
    );
    const [kainRows] = await pool.query(`SELECT jeniskain FROM tjeniskain`);
    const [warnaRows] = await pool.query(`SELECT warna FROM twarna`);

    // Gabungkan semua data menjadi satu array satu dimensi
    const validTerms = [
      ...cabangRows.map((r) => r.gdg_nama),
      ...kainRows.map((r) => r.jeniskain),
      ...warnaRows.map((r) => r.warna),
    ].filter(Boolean); // Filter null/undefined

    // Ubah ke format array of objects untuk Fuse
    const list = validTerms.map((term) => ({ term }));

    // Inisialisasi Fuse dengan data dari DB
    fuseInstance = new Fuse(list, {
      keys: ["term"],
      includeScore: true,
      threshold: 0.2,
      ignoreLocation: true,
    });

    console.log(
      `[TYPO CORRECTOR] Berhasil meload ${list.length} istilah baku.`,
    );
  } catch (error) {
    console.error("[TYPO CORRECTOR] Gagal mengambil data dari DB:", error);
  }
};

const correctUserTypo = (rawText) => {
  if (!rawText || !fuseInstance) return rawText;

  let correctedText = rawText.toLowerCase();

  // --- [FIX PENTING] AMANKAN FRASA PAGINATION ---
  // Ubah kata 'list' yang bermakna pagination agar tidak diproses sebagai kain
  correctedText = correctedText.replace(/10 list/g, "10 data");
  correctedText = correctedText.replace(
    /list berikutnya/g,
    "halaman berikutnya",
  );
  correctedText = correctedText.replace(
    /list selanjutnya/g,
    "halaman selanjutnya",
  );
  correctedText = correctedText.replace(/list lagi/g, "data lagi");

  // 1. Hard-Replace Alias Manual
  for (const [typo, valid] of Object.entries(aliases)) {
    const regex = new RegExp(`\\b${typo}\\b`, "g");
    correctedText = correctedText.replace(regex, valid.toLowerCase());
  }

  // --- [BARU] DAFTAR KATA YANG HARUS DIABAIKAN (TIDAK BOLEH DI-FUZZY) ---
  const stopWords = [
    "stok",
    "kaos",
    "warna",
    "cabang",
    "tolong",
    "dong",
    "cek",
    "dicek",
    "laporan",
    "penjualan",
    "untuk",
    "masing",
    "dari",
    "hari",
    "senin",
    "selasa",
    "rabu",
    "kamis",
    "jumat",
    "sabtu",
    "minggu",
    "sampai",
    "kemarin",
    "besok",
    "ini",
    "itu",
    "ada",
    "nggak",
    "tidak",
    "bisa",
    "berapa",
    "apa",
    "aja",
    "saja",
    "yang",
    "di",
    "ke",
    "buat",
    "terlaris",
    "boyolali",
    "padokan",
    "sragen",
    "jakarta",
    "surabaya",
    "malang",
    "combed",
    "carded",
    "polo",
    "katun",
    // --- Atribut fisik ---
    "pendek",
    "panjang",
    "size",
    "ukuran",
    "xl",
    "xxl",
    "hitam",
    "putih",
    "merah",
    "biru",
    "abu",
    "navy",
    "dongker",
    // --- [FIX PENTING] Kata terkait pagination agar aman dari typo corrector ---
    "list",
    "data",
    "halaman",
    "berikutnya",
    "selanjutnya",
    "lagi",
    "tambah",
  ];

  // 2. Fuzzy Matching untuk salah huruf
  const words = correctedText.split(/\s+/);
  let finalText = [];

  for (let word of words) {
    // Lewati kata pendek atau kata yang ada di dalam daftar stopWords
    if (word.length < 4 || stopWords.includes(word)) {
      finalText.push(word);
      continue;
    }

    const results = fuseInstance.search(word);

    // Sesuaikan threshold dengan yang ada di konfigurasi atas (0.2)
    if (results.length > 0 && results[0].score <= 0.2) {
      finalText.push(results[0].item.term.toLowerCase());
    } else {
      finalText.push(word);
    }
  }

  return finalText.join(" ");
};

module.exports = { initTypoCorrector, correctUserTypo };
