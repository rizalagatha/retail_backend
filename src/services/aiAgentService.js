const aiService = require("./aiService");
const dashboardService = require("./dashboardService");
const { buildTools, CABANG_ALIAS } = require("../config/aiTools");
const { SYSTEM_PROMPT } = require("../config/aiPrompt");
const aiFormatters = require("../config/aiFormatters");
const aiQueueService = require("./aiQueueService");
const aiStateService = require("./aiStateService");
const { format } = require("date-fns");
const { correctUserTypo } = require("../config/typoCorrector");

const MAX_TOOL_ROUNDS = 3;

// [BARU] Model routing — eskalasi ke Sonnet HANYA untuk round narasi final
// pada pertanyaan yang butuh reasoning analitik (bukan sekadar tarik data).
// Sengaja pakai keyword heuristic (bukan minta Haiku self-flag) supaya
// TIDAK menambah API call ekstra ke SEMUA request — cukup cek string,
// gratis dari sisi token/biaya.
const SONNET_MODEL = "claude-sonnet-5";

const ANALYTICAL_KEYWORDS = [
  "kenapa",
  "napa",
  "kok",
  "penyebab",
  "alasan",
  "analisis",
  "analisa",
  "jelaskan kenapa",
  "kok bisa",
  "rancang",
  "rancangkan",
  "rumuskan",
  "strategi",
  "rekomendasi",
];

const needsDeepAnalysis = (text) => {
  const lower = (text || "").toLowerCase();
  return ANALYTICAL_KEYWORDS.some((kw) => lower.includes(kw));
};

// [BARU] Sapaan sederhana dijawab langsung dari kode — tidak perlu antri
// atau panggil LLM sama sekali. Selain jauh lebih cepat, ini juga menjamin
// bahasanya selalu Indonesia (model kecil kadang tidak konsisten untuk
// prompt super pendek tanpa konteks).
const GREETING_PATTERNS = [
  "halo",
  "hai",
  "hi",
  "hello",
  "hey",
  "tes",
  "test",
  "p",
];

const isSimpleGreeting = (text) => {
  const clean = (text || "")
    .trim()
    .toLowerCase()
    .replace(/[!?.,]/g, "");
  return GREETING_PATTERNS.includes(clean);
};

const processMessage = async (incomingMessages, user, sessionId = null) => {
  const { waitingCount } = aiQueueService.getQueueStatus();
  const queuedAtStart = waitingCount; // posisi antrian SEBELUM slot didapat

  if (queuedAtStart > 0) {
    console.log(
      `[AI QUEUE] Ada ${queuedAtStart} request lain menunggu giliran di depan ini.`,
    );
  }

  await aiQueueService.acquireSlot(); // nunggu di sini kalau slot lagi penuh

  try {
    // [BARU] Bypass total untuk sapaan sederhana — skip antrian & LLM sepenuhnya
    const lastUserMsg = [...incomingMessages]
      .reverse()
      .find((m) => m.role === "user");
    if (lastUserMsg && isSimpleGreeting(lastUserMsg.content)) {
      return "Halo! Saya Kaosan AI, siap bantu cek data toko — coba tanya soal penjualan, stok, atau piutang hari ini.";
    }

    // 1. Ambil daftar cabang dari DB (bukan hardcode) untuk enum parameter tool
    const cabangOptionsRaw = await dashboardService.getCabangOptions(user);

    // [BARU] Ambil daftar warna valid dari tabel twarna
    const daftarWarnaRaw = await dashboardService.getDaftarWarna();
    // Gabungkan menjadi satu kalimat dipisahkan koma
    const warnaLegend =
      daftarWarnaRaw.length > 0
        ? daftarWarnaRaw.join(", ")
        : "Tidak ada data warna";

    // [BARU] Channel penjualan tambahan (bukan toko fisik K01-K12) — cuma
    // relevan untuk konteks AI (laporan piutang/penjualan lintas channel),
    // sengaja tidak disuntik ke getCabangOptions supaya tidak mengubah
    // dropdown/filter di fitur lain yang belum tentu mau nampilkan ini.
    const EXTRA_CABANG_AI = [
      { kode: "KPR", nama: "PRIORITAS" },
      { kode: "KON", nama: "KAOSAN ONLINE" },
    ];
    const existingKodes = new Set(cabangOptionsRaw.map((c) => c.kode));
    const cabangOptions = [
      ...cabangOptionsRaw,
      ...EXTRA_CABANG_AI.filter((c) => !existingKodes.has(c.kode)),
    ];

    // Cari sinyal cabang dari SELURUH histori user
    const recentUserMessages = incomingMessages
      .filter((m) => m.role === "user")
      .slice(-6);

    // --- TAMBAHKAN KOREKSI TYPO DI SINI ---
    const rawUserText = recentUserMessages.map((m) => m.content).join(" ");
    const allUserText = correctUserTypo(rawUserText);

    console.log(
      `[TYPO CHECK] Asli: "${rawUserText}" | Koreksi: "${allUserText}"`,
    );

    // [FIX] Baris ini sempat hilang saat refactor system prompt caching
    const { tools, executors } = buildTools(user, cabangOptions, allUserText);

    // [BARU] Cek sinyal butuh analisis mendalam dari kalimat user
    const hasAnalyticalIntent = needsDeepAnalysis(allUserText);
    const toolNamesCalled = new Set(); // dipakai buat cek syarat ke-2 (>=2 tool)

    const cabangLegend = cabangOptions
      .map((c) => `${c.kode}=${c.nama}`)
      .join(", ");

    const aliasNotes = Object.entries(CABANG_ALIAS)
      .map(([kota, kode]) => `"${kota}" (tanpa keterangan lain) = ${kode}`)
      .join("; ");

    const activeState = aiStateService.getActiveState(sessionId);
    const activeStateDesc = aiStateService.describeActiveState(activeState);

    // [UBAH] Pisah jadi 2 blok: STABIL (di-cache) vs DINAMIS (tidak di-cache).
    // Ini penting untuk efektivitas prompt caching — kalau digabung jadi 1
    // string, setiap kali activeStateDesc/todayStr berubah (yaitu HAMPIR
    // SETIAP request, karena beda sesi/beda state), SELURUH blok termasuk
    // instruksi besar SYSTEM_PROMPT ikut gagal cache. Dengan dipisah,
    // bagian besar & jarang berubah tetap ke-cache walau bagian kecil beda.
    const stableSystemPrompt = `${SYSTEM_PROMPT}

Konteks tetap:
- Daftar kode cabang: ${cabangLegend}
- Catatan disambiguasi nama kota: ${aliasNotes} (ada 2 brand berbeda di kota yang sama, pastikan pilih kode yang sesuai catatan ini)
- DAFTAR WARNA VALID DI DATABASE: ${warnaLegend}
`;

    const todayStr = format(new Date(), "yyyy-MM-dd (EEEE)");
    const dynamicContext = `Konteks saat ini:
- Hari ini: ${todayStr}
- User yang bertanya: cabang ${user.cabang}${
      user.cabang === "KDC"
        ? " (Kantor Pusat, bisa lihat semua cabang)"
        : " (Store, hanya bisa lihat data cabangnya sendiri)"
    }${activeStateDesc ? `\n- Konteks aktif (topik terakhir yang sedang dibahas): ${activeStateDesc}. Jika pesan user sekarang adalah follow-up singkat (ganti cabang/periode/warna/kata kunci saja, tanpa menyebut topik baru), WAJIB lanjutkan dengan tool yang sama sesuai konteks aktif ini.` : ""}
`;

    // 3. Riwayat percakapan dari frontend (sudah dibatasi 6 pesan terakhir di sana)
    let conversation = [...incomingMessages];

    const lastUserIndex = conversation.findLastIndex((m) => m.role === "user");
    if (lastUserIndex !== -1) {
      conversation[lastUserIndex].content = correctUserTypo(
        conversation[lastUserIndex].content,
      );
    }

    // 4. Loop tool-calling
    let lastSingleResult = null;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const t0 = Date.now();
      const isLastRound = round === MAX_TOOL_ROUNDS - 1;

      // [BARU] Eskalasi model HANYA jika kedua syarat terpenuhi: kalimat
      // user mengandung kata kunci analitik, DAN sudah ada >=2 tool
      // berbeda yang terpanggil di round-round sebelumnya (bukti investigasi
      // multi-sumber sedang berjalan, sesuai pola rule 11 diagnostik).
      // Round pertama SELALU Haiku (toolNamesCalled masih kosong di awal),
      // jadi tool-selection tetap murah — cuma round narasi setelahnya
      // yang berpotensi naik ke Sonnet.
      const useDeepModel = hasAnalyticalIntent && toolNamesCalled.size >= 2;
      const modelForThisCall = useDeepModel ? SONNET_MODEL : undefined;

      if (useDeepModel) {
        console.log(
          `[AI] Round ${round + 1}: eskalasi ke Sonnet (analytical intent + ${toolNamesCalled.size} tool terpanggil)`,
        );
      }

      console.log(`[AI] Round ${round + 1}/${MAX_TOOL_ROUNDS}...`);
      let assistantMessage;
      try {
        assistantMessage = await aiService.sendChat(conversation, {
          temperature: 0.2,
          tools: isLastRound ? [] : tools,
          systemStable: stableSystemPrompt,
          systemDynamic: dynamicContext,
          model: modelForThisCall, // [BARU] undefined = pakai default Haiku di aiService.js
        });
      } catch (err) {
        if (err.isToolFormatError) {
          console.warn("[AI] Tool format error, retry 1x...");
          assistantMessage = await aiService.sendChat(conversation, {
            temperature: 0.2,
            tools: isLastRound ? [] : tools,
            systemStable: stableSystemPrompt,
            systemDynamic: dynamicContext,
            model: modelForThisCall, // [BARU]
          });
        } else {
          throw err;
        }
      }
      console.log(
        `[AI] Round ${round + 1} selesai dalam ${((Date.now() - t0) / 1000).toFixed(1)}s. Tool calls:`,
        assistantMessage.tool_calls?.length || 0,
      );

      const toolCalls = assistantMessage.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        return (
          assistantMessage.content || "Maaf, saya tidak bisa menjawab itu."
        );
      }

      conversation.push(assistantMessage);
      const executedResults = [];

      for (const call of toolCalls) {
        const fnName = call.function?.name;
        let args = {};
        try {
          args =
            typeof call.function?.arguments === "string"
              ? JSON.parse(call.function.arguments)
              : call.function?.arguments || {};
        } catch {
          args = {};
        }

        let resultContent;
        try {
          const executor = executors[fnName];
          if (!executor) {
            resultContent = { error: `Tool '${fnName}' tidak dikenali.` };
          } else {
            resultContent = await executor(args);
          }
        } catch (err) {
          resultContent = { error: `Gagal mengambil data: ${err.message}` };
        }

        conversation.push({
          role: "tool",
          tool_call_id: call.id,
          name: fnName,
          content: JSON.stringify(resultContent),
        });
        executedResults.push({ fnName, args, resultContent });
      }

      // [BARU] Catat nama tool yang terpanggil (dedup otomatis via Set) —
      // dipakai buat syarat eskalasi model di round berikutnya
      executedResults.forEach((r) => {
        if (!r.resultContent?.error) toolNamesCalled.add(r.fnName);
      });

      // [BARU] Simpan tool call TERAKHIR yang berhasil (bukan yang error)
      // sebagai state aktif sesi ini, buat dipakai di request berikutnya.
      const successfulCalls = executedResults.filter(
        (r) => !r.resultContent?.error,
      );
      if (successfulCalls.length > 0) {
        const last = successfulCalls[successfulCalls.length - 1];
        aiStateService.setActiveState(sessionId, last.fnName, last.args);
      }

      // [UBAH] Formatter TIDAK lagi jadi fast-path yang langsung return.
      // Biarkan Claude sendiri yang menyusun jawaban di round berikutnya
      // pakai data tool result yang sudah ada di `conversation` — hasilnya
      // lebih natural, nggak template. Formatter cuma disimpan sebagai
      // cadangan (lihat safety net di bawah, setelah loop selesai).
      if (executedResults.length === 1) {
        lastSingleResult = executedResults[0];
      }
    }

    // Safety net: kalau semua round habis TANPA jawaban teks sama sekali,
    // pakai formatter template daripada nampilin pesan generik "terlalu
    // kompleks" — lebih mendingan data mentah rapi daripada nggak jawab.
    if (lastSingleResult) {
      const { fnName, args, resultContent } = lastSingleResult;
      const formatter = aiFormatters[fnName];
      const isDataEmpty =
        !resultContent ||
        (Array.isArray(resultContent) && resultContent.length === 0) ||
        (resultContent.data && resultContent.data.length === 0);
      if (formatter && !resultContent?.error && !isDataEmpty) {
        try {
          return formatter(args, resultContent);
        } catch (fmtErr) {
          console.error(
            `[AI FORMATTER FALLBACK ERROR] ${fnName}:`,
            fmtErr.message,
          );
        }
      }
    }

    return "Maaf, permintaan ini terlalu kompleks untuk saya proses saat ini.";
  } catch (error) {
    console.error("[AI AGENT] Error:", error);
    if (error.isRateLimit) {
      return error.message.replace("RATE_LIMIT: ", "");
    }
    return "Maaf, sistem AI sedang mengalami gangguan saat mengambil data.";
  } finally {
    aiQueueService.releaseSlot();
  }
};

module.exports = { processMessage };
