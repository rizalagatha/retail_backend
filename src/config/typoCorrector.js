const Fuse = require("fuse.js");
const pool = require("../config/database");

let fuseInstance = null;

const aliases = {
  lakos: "lacos",
  nevi: "navy/dongker",
  nepi: "navy/dongker",
  stiker: "sticker",
  aiar: "air",
  sby: "surabaya",
  pdk: "padokan",
  // [DIHAPUS] k06: "boyolali" — ini penyebab nomor dokumen "K06.SO.2607.0008"
  // ikut ke-translate jadi "boyolali.so.2607.0008", karena regex \bk06\b
  // menganggap "k06" di depan nomor dokumen sebagai kata tersendiri (titik
  // dihitung word-boundary). JANGAN tambahkan alias KODE CABANG lagi di sini
  // — kalau perlu bantu pencarian pakai nama kota, lakukan di level pencarian
  // tool (lihat CABANG_ALIAS di aiTools.js), BUKAN di sini, karena fungsi ini
  // menyentuh SELURUH isi pesan termasuk nomor dokumen yang harus tetap persis.
};

// [BARU] Pola nomor dokumen Kaosan — dipakai untuk "melindungi" substring ini
// dari alias replacement & fuzzy matching apapun, sebelum proses lain jalan.
// Mencakup SO/INV/PEN dan semua tipe jasa produksi (SD/BR/PM/DP/TG/PL/SB)
// sesuai pola yang sudah dipakai di excludePattern (dashboardService.js).
const DOCUMENT_NUMBER_REGEX =
  /\b[A-Za-z]{2,4}\d{0,2}\.(SO|INV|PEN|SD|BR|PM|DP|TG|PL|SB)\.\d{2,6}\.?\d{0,6}\b/gi;

const initTypoCorrector = async () => {
  try {
    console.log("[TYPO CORRECTOR] Mengambil master data dari database...");
    const [cabangRows] = await pool.query(
      `SELECT gdg_nama FROM tgudang WHERE gdg_dc = '0'`,
    );
    const [kainRows] = await pool.query(`SELECT jeniskain FROM tjeniskain`);
    const [warnaRows] = await pool.query(`SELECT warna FROM twarna`);

    const validTerms = [
      ...cabangRows.map((r) => r.gdg_nama),
      ...kainRows.map((r) => r.jeniskain),
      ...warnaRows.map((r) => r.warna),
    ].filter(Boolean);

    const list = validTerms.map((term) => ({ term }));

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

  // --- [BARU] LANGKAH 0: LINDUNGI NOMOR DOKUMEN ---
  // Ekstrak SEBELUM di-lowercase/diproses apapun, simpan bentuk ASLI-nya
  // (case-sensitive), ganti sementara dengan placeholder yang mustahil
  // ke-fuzzy-match atau ke-alias (huruf kapital + underscore, bukan pola
  // kata wajar). Placeholder dikembalikan ke teks asli di akhir fungsi.
  const protectedDocs = [];
  let textWithPlaceholders = rawText.replace(DOCUMENT_NUMBER_REGEX, (match) => {
    const idx = protectedDocs.length;
    protectedDocs.push(match);
    return `__DOC${idx}__`;
  });

  let correctedText = textWithPlaceholders.toLowerCase();

  // --- AMANKAN FRASA PAGINATION ---
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
    // Placeholder dokumen juga di-skip di sini (jaga-jaga, meski secara
    // teori sudah tidak match pola kata manapun karena formatnya unik)
    if (
      word.length < 4 ||
      stopWords.includes(word) ||
      word.startsWith("__doc")
    ) {
      finalText.push(word);
      continue;
    }

    const results = fuseInstance.search(word);
    if (results.length > 0 && results[0].score <= 0.2) {
      finalText.push(results[0].item.term.toLowerCase());
    } else {
      finalText.push(word);
    }
  }

  let result = finalText.join(" ");

  // --- [BARU] KEMBALIKAN NOMOR DOKUMEN ASLI ---
  protectedDocs.forEach((original, idx) => {
    // Placeholder ikut ter-lowercase jadi "__doc0__" — replace case-insensitive
    const placeholderRegex = new RegExp(`__doc${idx}__`, "i");
    result = result.replace(placeholderRegex, original);
  });

  return result;
};

module.exports = { initTypoCorrector, correctUserTypo };
