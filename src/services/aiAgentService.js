const aiService = require("./aiService");
const dashboardService = require("./dashboardService");
const { buildTools } = require("../config/aiTools");
const { SYSTEM_PROMPT } = require("../config/aiPrompt");
const aiFormatters = require("../config/aiFormatters");
const aiQueueService = require("./aiQueueService");
const aiStateService = require("./aiStateService");
const { format } = require("date-fns");
const { correctUserTypo } = require("../config/typoCorrector");

const MAX_TOOL_ROUNDS = 3;

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
      .slice(-3);

    // --- TAMBAHKAN KOREKSI TYPO DI SINI ---
    const rawUserText = recentUserMessages.map((m) => m.content).join(" ");
    const allUserText = correctUserTypo(rawUserText);

    console.log(
      `[TYPO CHECK] Asli: "${rawUserText}" | Koreksi: "${allUserText}"`,
    );
    // --------------------------------------
    // [BARU] Legend cabang disebut SEKALI di system prompt — sebelumnya
    // daftar 12 cabang ini di-copy ke deskripsi parameter di 5 tool
    // berbeda, boros token per request (relevan untuk kuota Groq 6000 tok/menit).
    const cabangLegend = cabangOptions
      .map((c) => `${c.kode}=${c.nama}`)
      .join(", ");

    // [BARU] Ambil state aktif dari sesi ini (kalau ada) dan susun jadi
    // kalimat konteks eksplisit — mengurangi beban model buat re-infer
    // konteks dari histori teks mentah tiap kali user follow-up singkat.
    const activeState = aiStateService.getActiveState(sessionId);
    const activeStateDesc = aiStateService.describeActiveState(activeState);

    const cukupPanggil = buildTools(user, cabangOptions, allUserText);
    const { tools, executors } = cukupPanggil;

    const todayStr = format(new Date(), "yyyy-MM-dd (EEEE)");
    const systemPrompt = `${SYSTEM_PROMPT}

Konteks tambahan:
- Hari ini: ${todayStr}
- User yang bertanya: cabang ${user.cabang}${
      user.cabang === "KDC"
        ? " (Kantor Pusat, bisa lihat semua cabang)"
        : " (Store, hanya bisa lihat data cabangnya sendiri)"
    }
- Daftar kode cabang: ${cabangLegend}
- DAFTAR WARNA VALID DI DATABASE: ${warnaLegend}
${activeStateDesc ? `- Konteks aktif (topik terakhir yang sedang dibahas): ${activeStateDesc}. Jika pesan user sekarang adalah follow-up singkat (ganti cabang/periode/warna/kata kunci saja, tanpa menyebut topik baru), WAJIB lanjutkan dengan tool yang sama sesuai konteks aktif ini.` : ""}
`;

    // 3. Riwayat percakapan dari frontend (sudah dibatasi 6 pesan terakhir di sana)
    let conversation = [
      { role: "system", content: systemPrompt },
      ...incomingMessages,
    ];

    const lastUserIndex = conversation.findLastIndex((m) => m.role === "user");
    if (lastUserIndex !== -1) {
      conversation[lastUserIndex].content = correctUserTypo(
        conversation[lastUserIndex].content,
      );
    }

    // 4. Loop tool-calling
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const t0 = Date.now();
      const isLastRound = round === MAX_TOOL_ROUNDS - 1;
      console.log(`[AI] Round ${round + 1}/${MAX_TOOL_ROUNDS}...`);
      let assistantMessage;
      try {
        assistantMessage = await aiService.sendChat(conversation, {
          temperature: 0.2,
          // [BARU] Round terakhir: JANGAN kirim tools lagi — paksa model
          // kasih jawaban teks final (hemat token skema, dan cegah loop
          // "mau manggil tool lagi" yang berakhir di fallback kompleks).
          tools: isLastRound ? [] : tools,
        });
      } catch (err) {
        if (err.isToolFormatError) {
          // [BARU] Retry SEKALI — biasanya cukup, karena ini glitch acak
          // model saat menutup tag function call, bukan kesalahan logic.
          console.warn("[AI] Tool format error, retry 1x...");
          assistantMessage = await aiService.sendChat(conversation, {
            temperature: 0.2,
            tools: isLastRound ? [] : tools,
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

      // [BARU] Simpan tool call TERAKHIR yang berhasil (bukan yang error)
      // sebagai state aktif sesi ini, buat dipakai di request berikutnya.
      const successfulCalls = executedResults.filter(
        (r) => !r.resultContent?.error,
      );
      if (successfulCalls.length > 0) {
        const last = successfulCalls[successfulCalls.length - 1];
        aiStateService.setActiveState(sessionId, last.fnName, last.args);
      }

      if (executedResults.length === 1) {
        const { fnName, args, resultContent } = executedResults[0];
        const formatter = aiFormatters[fnName];

        const isDataEmpty =
          !resultContent ||
          (Array.isArray(resultContent) && resultContent.length === 0) ||
          (resultContent.data && resultContent.data.length === 0);

        if (formatter && !resultContent?.error && !isDataEmpty) {
          try {
            return formatter(args, resultContent);
          } catch (fmtErr) {
            console.error(`[AI FORMATTER ERROR] ${fnName}:`, fmtErr.message);
          }
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
