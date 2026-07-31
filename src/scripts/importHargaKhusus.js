/**
 * Script Import Harga Khusus Customer (Prioritas/Franchise) — v3
 * ============================================================
 * Baca file Excel harga khusus, cocokkan tiap baris ke tbarangdc + tbarangdc_dtl,
 * lalu (opsional) insert ke tabel tcustomer_harga_khusus.
 *
 * [v3] Matching sekarang BAG-OF-WORDS: kata-kata pembentuk nama barang
 * (Jenis Kaos + Bahan[+ Warna]) dibandingkan sebagai KUMPULAN kata yang
 * di-sort, bukan string gabungan berurutan. Ini menyelesaikan kasus seperti
 * "KK POLOS POLO PENDEK" + Bahan "LACOS CVC" (Excel) vs DB yang menyimpan
 * kata "POLO" di dalam brg_jeniskain ("POLO LACOS CVC") bukan di brg_lengan
 * — urutan katanya beda tapi kumpulan katanya identik, sekarang tetap match.
 *
 * [v2] Dukungan WARNA WILDCARD: kalau kolom "Warna" berisi literal "WARNA",
 * itu artinya harga berlaku untuk SEMUA warna barang tersebut KECUALI warna
 * yang sudah punya baris harga sendiri secara eksplisit di Excel.
 *
 * CARA PAKAI:
 *   node importHargaKhusus.js <path_excel> <cus_kode> [--commit]
 */

const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const pool = require("../config/database"); // [SESUAIKAN PATH INI]

const args = process.argv.slice(2);
const excelPath = args[0];
const cusKode = args[1];
const shouldCommit = args.includes("--commit");

if (!excelPath || !cusKode) {
  console.error(
    "Penggunaan: node importHargaKhusus.js <path_excel> <cus_kode> [--commit]",
  );
  process.exit(1);
}

// ── Helper normalisasi & tokenisasi ───────────────────────────────────
const normalize = (str) =>
  (str || "").toString().toUpperCase().trim().replace(/\s+/g, " ");

// [BARU] Bag-of-words: pecah jadi kata, sort, gabung lagi — urutan kata
// jadi tidak masalah, tapi kumpulan katanya harus identik persis.
const tokenize = (str) =>
  normalize(str).split(" ").filter(Boolean).sort().join("|");

const isWildcardWarna = (warna) => normalize(warna) === "WARNA";

const levenshtein = (a, b) => {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
};

const similarityScore = (a, b) => {
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length) || 1;
  return 1 - dist / maxLen;
};

// ── Baca semua kandidat barang dari DB sekali saja (di-cache di memory) ──
const loadAllCandidates = async () => {
  const [rows] = await pool.query(`
    SELECT 
      a.brg_kode,
      a.brg_jeniskaos,
      a.brg_tipe,
      a.brg_lengan,
      a.brg_jeniskain,
      a.brg_warna,
      a.brg_aktif,
      d.brgd_ukuran,
      d.brgd_harga
    FROM tbarangdc a
    JOIN tbarangdc_dtl d ON d.brgd_kode = a.brg_kode
    WHERE a.brg_aktif = 0
  `);

  return rows.map((r) => {
    const fullNameDisplay = normalize(
      `${r.brg_jeniskaos} ${r.brg_tipe} ${r.brg_lengan} ${r.brg_jeniskain} ${r.brg_warna}`,
    );
    return {
      ...r,
      fullNameDisplay,
      // [BARU] Token gabungan TANPA warna — dipakai untuk wildcard "WARNA"
      prefixTokens: tokenize(
        `${r.brg_jeniskaos} ${r.brg_tipe} ${r.brg_lengan} ${r.brg_jeniskain}`,
      ),
      // [BARU] Token gabungan LENGKAP termasuk warna — dipakai untuk warna spesifik
      fullTokens: tokenize(
        `${r.brg_jeniskaos} ${r.brg_tipe} ${r.brg_lengan} ${r.brg_jeniskain} ${r.brg_warna}`,
      ),
      warnaNormalized: normalize(r.brg_warna),
      ukuranNormalized: normalize(r.brgd_ukuran),
    };
  });
};

// ── Cari kandidat untuk warna SPESIFIK (HITAM, PUTIH, dst) ────────────
const findSingleColorMatch = (row, candidates) => {
  const targetTokens = tokenize(`${row.jenisKaos} ${row.bahan} ${row.warna}`);
  const targetUkuranNorm = normalize(row.ukuran);

  const sameSizeCandidates = candidates.filter(
    (c) => c.ukuranNormalized === targetUkuranNorm,
  );

  if (sameSizeCandidates.length === 0) {
    return {
      status: "NOT_FOUND",
      reason: "Ukuran tidak ditemukan di master barang",
      matches: [],
    };
  }

  const exactMatches = sameSizeCandidates.filter(
    (c) => c.fullTokens === targetTokens,
  );

  if (exactMatches.length === 1) {
    return { status: "EXACT", reason: null, matches: exactMatches };
  }
  if (exactMatches.length > 1) {
    return {
      status: "AMBIGUOUS",
      reason: `Ditemukan ${exactMatches.length} kode barang dengan kumpulan kata identik`,
      matches: exactMatches,
    };
  }

  // Fallback fuzzy pakai skor kemiripan (bandingkan token string, bukan raw string)
  const scored = sameSizeCandidates
    .map((c) => ({ ...c, score: similarityScore(targetTokens, c.fullTokens) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const topScore = scored[0]?.score || 0;

  if (topScore >= 0.85) {
    return {
      status: "AMBIGUOUS",
      reason: `Mirip (skor ${(topScore * 100).toFixed(0)}%) tapi tidak identik — cek manual`,
      matches: scored,
    };
  }

  return {
    status: "NOT_FOUND",
    reason: "Tidak ada kandidat yang cukup mirip",
    matches: scored,
  };
};

// ── Cari SEMUA kandidat untuk warna WILDCARD ─────────────────────────
const findWildcardColorMatches = (row, candidates, excludedColorsSet) => {
  const targetTokens = tokenize(`${row.jenisKaos} ${row.bahan}`);
  const targetUkuranNorm = normalize(row.ukuran);

  const matches = candidates.filter(
    (c) =>
      c.prefixTokens === targetTokens &&
      c.ukuranNormalized === targetUkuranNorm &&
      !excludedColorsSet.has(c.warnaNormalized),
  );

  if (matches.length === 0) {
    return {
      status: "NOT_FOUND",
      reason:
        "Wildcard WARNA: tidak ada produk dengan kombinasi Jenis Kaos+Bahan+Ukuran ini",
      matches: [],
    };
  }

  return {
    status: "EXACT_MULTI",
    reason: `Wildcard WARNA cocok ke ${matches.length} varian warna berbeda`,
    matches,
  };
};

// ── Baca Excel ──────────────────────────────────────────────────────
const readExcelRows = async (filePath) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const allRows = [];

  workbook.eachSheet((sheet) => {
    const headerRow = sheet.getRow(1);
    const colIndex = {};
    headerRow.eachCell((cell, colNumber) => {
      const val = normalize(cell.value);
      if (val.includes("JENIS KAOS")) colIndex.jenisKaos = colNumber;
      else if (val.includes("WARNA")) colIndex.warna = colNumber;
      else if (val.includes("BAHAN")) colIndex.bahan = colNumber;
      else if (val.includes("UKURAN")) colIndex.ukuran = colNumber;
      else if (val.includes("TOTAL HARGA")) colIndex.totalHarga = colNumber;
    });

    if (!colIndex.jenisKaos || !colIndex.ukuran || !colIndex.totalHarga) {
      console.warn(
        `[SKIP] Sheet "${sheet.name}" dilewati — header kolom wajib tidak ditemukan.`,
      );
      return;
    }

    for (let i = 2; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);
      const jenisKaos = row.getCell(colIndex.jenisKaos).value;
      const warna = colIndex.warna ? row.getCell(colIndex.warna).value : "";
      const bahan = colIndex.bahan ? row.getCell(colIndex.bahan).value : "";
      const ukuran = row.getCell(colIndex.ukuran).value;
      const totalHarga = row.getCell(colIndex.totalHarga).value;

      if (
        !jenisKaos ||
        !ukuran ||
        totalHarga === null ||
        totalHarga === undefined
      ) {
        continue;
      }

      const jenisKaosStr = String(jenisKaos).trim();
      const warnaStr = String(warna || "").trim();
      const bahanStr = String(bahan || "").trim();
      const ukuranStr = String(ukuran).trim();

      allRows.push({
        sheet: sheet.name,
        rowNumber: i,
        jenisKaos: jenisKaosStr,
        warna: warnaStr,
        bahan: bahanStr,
        ukuran: ukuranStr,
        targetName: `${jenisKaosStr} ${bahanStr} ${warnaStr}`.trim(),
        hargaFinal: Number(totalHarga),
      });
    }
  });

  return allRows;
};

const buildExplicitColorsByGroup = (excelRows) => {
  const map = new Map();
  excelRows.forEach((row) => {
    if (!isWildcardWarna(row.warna) && row.warna) {
      const key = tokenize(`${row.jenisKaos} ${row.bahan}`);
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(normalize(row.warna));
    }
  });
  return map;
};

// ── CSV writer ──────────────────────────────────────────────────────
const escapeCsv = (val) => {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

const writeReportCsv = (filePath, rows) => {
  const headers = [
    "Sheet",
    "Baris Excel",
    "Target Nama",
    "Target Ukuran",
    "Harga Final (Excel)",
    "Status",
    "Alasan",
    "Jumlah Varian Cocok",
    "Kode Barang Tercocok",
    "Detail Kandidat",
  ];

  const lines = [headers.join(",")];

  rows.forEach((r) => {
    const top = r.matches[0];
    const detailList = r.matches
      .slice(0, 8)
      .map((m) => {
        const scoreLabel =
          m.score !== undefined ? `${(m.score * 100).toFixed(0)}%` : "exact";
        return `${m.brg_kode}[${m.brg_warna}](${scoreLabel})`;
      })
      .join(" | ");
    const moreLabel =
      r.matches.length > 8 ? ` +${r.matches.length - 8} lagi` : "";

    lines.push(
      [
        escapeCsv(r.sheet),
        escapeCsv(r.rowNumber),
        escapeCsv(r.targetName),
        escapeCsv(r.ukuran),
        escapeCsv(r.hargaFinal),
        escapeCsv(r.status),
        escapeCsv(r.reason || ""),
        escapeCsv(r.matches.length),
        escapeCsv(top ? top.brg_kode : ""),
        escapeCsv(detailList + moreLabel),
      ].join(","),
    );
  });

  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
};

// ── Insert ke DB ──────────────────────────────────────────────────────
const commitMatches = async (rows, cusKode) => {
  const values = [];
  rows.forEach((r) => {
    r.matches.forEach((m) => {
      values.push([
        cusKode,
        m.brg_kode,
        r.ukuran,
        r.hargaFinal,
        1,
        "SCRIPT_IMPORT",
      ]);
    });
  });

  if (values.length === 0) {
    console.log("Tidak ada baris yang bisa di-commit.");
    return;
  }

  const sql = `
    INSERT INTO tcustomer_harga_khusus 
      (chk_cus_kode, chk_brg_kode, chk_ukuran, chk_harga, chk_aktif, user_create)
    VALUES ?
    ON DUPLICATE KEY UPDATE 
      chk_harga = VALUES(chk_harga), 
      chk_aktif = VALUES(chk_aktif)
  `;

  const [result] = await pool.query(sql, [values]);
  console.log(
    `✅ Commit selesai: ${result.affectedRows} baris ter-insert/update ke tcustomer_harga_khusus.`,
  );
};

// ── MAIN ────────────────────────────────────────────────────────────
const main = async () => {
  console.log(`Membaca Excel: ${excelPath}`);
  const excelRows = await readExcelRows(excelPath);
  console.log(`Ditemukan ${excelRows.length} baris data harga di Excel.`);

  const explicitColorsByGroup = buildExplicitColorsByGroup(excelRows);

  console.log("Memuat daftar barang dari database...");
  const candidates = await loadAllCandidates();
  console.log(
    `Dimuat ${candidates.length} kombinasi barang+ukuran dari tbarangdc.`,
  );

  console.log(
    "Mencocokkan tiap baris Excel ke master barang (bag-of-words)...",
  );
  const results = excelRows.map((row) => {
    let match;
    if (isWildcardWarna(row.warna)) {
      const groupKey = tokenize(`${row.jenisKaos} ${row.bahan}`);
      const excluded = explicitColorsByGroup.get(groupKey) || new Set();
      match = findWildcardColorMatches(row, candidates, excluded);
    } else {
      match = findSingleColorMatch(row, candidates);
    }
    return { ...row, ...match };
  });

  const summary = { EXACT: 0, EXACT_MULTI: 0, AMBIGUOUS: 0, NOT_FOUND: 0 };
  let totalInsertRows = 0;
  results.forEach((r) => {
    summary[r.status]++;
    if (r.status === "EXACT" || r.status === "EXACT_MULTI") {
      totalInsertRows += r.matches.length;
    }
  });

  console.log("\n=== RINGKASAN MATCHING ===");
  console.log(`EXACT        : ${summary.EXACT}  (warna spesifik, 1:1)`);
  console.log(
    `EXACT_MULTI  : ${summary.EXACT_MULTI}  (wildcard WARNA, banyak varian per baris)`,
  );
  console.log(`AMBIGUOUS    : ${summary.AMBIGUOUS}  (perlu review manual)`);
  console.log(
    `NOT_FOUND    : ${summary.NOT_FOUND}  (kode barang tidak ketemu di DB)`,
  );
  console.log(
    `\nTotal baris yang akan di-insert ke tcustomer_harga_khusus: ${totalInsertRows}`,
  );

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(
    process.cwd(),
    `harga_khusus_report_${cusKode}_${timestamp}.csv`,
  );
  writeReportCsv(reportPath, results);
  console.log(`\nLaporan lengkap ditulis ke: ${reportPath}`);

  if (shouldCommit) {
    const rowsToCommit = results.filter(
      (r) => r.status === "EXACT" || r.status === "EXACT_MULTI",
    );
    console.log(
      `\nMenjalankan commit untuk ${rowsToCommit.length} baris Excel...`,
    );
    await commitMatches(rowsToCommit, cusKode);
  } else {
    console.log(
      "\n[DRY-RUN] Belum ada yang di-insert ke DB. Review dulu file CSV di atas, " +
        "lalu jalankan ulang dengan flag --commit untuk insert baris EXACT & EXACT_MULTI.",
    );
  }

  await pool.end();
};

main().catch((err) => {
  console.error("Gagal menjalankan import:", err);
  process.exit(1);
});
