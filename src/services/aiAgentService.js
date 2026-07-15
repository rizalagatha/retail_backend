const aiService = require("./aiService");
const dashboardService = require("./dashboardService");
const { buildTools } = require("../config/aiTools");
const { SYSTEM_PROMPT } = require("../config/aiPrompt");
const aiFormatters = require("../config/aiFormatters");
const aiQueueService = require("./aiQueueService");
const { format } = require("date-fns");

const MAX_TOOL_ROUNDS = 2;

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

const processMessage = async (incomingMessages, user) => {
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

    // [FIX] Cari sinyal cabang dari SELURUH histori user (bukan cuma pesan
    // terakhir) — supaya follow-up seperti "selain 10 itu ada lagi?" tetap
    // "ingat" cabang yang disebut di pertanyaan sebelumnya dalam sesi ini.
    const allUserText = incomingMessages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join(" ");

    const { tools, executors } = buildTools(user, cabangOptions, allUserText);

    // [BARU] Legend cabang disebut SEKALI di system prompt — sebelumnya
    // daftar 12 cabang ini di-copy ke deskripsi parameter di 5 tool
    // berbeda, boros token per request (relevan untuk kuota Groq 6000 tok/menit).
    const cabangLegend = cabangOptions
      .map((c) => `${c.kode}=${c.nama}`)
      .join(", ");

    // 2. Bangun system prompt dinamis: tanggal hari ini + konteks user yang login
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
- Jika tidak ada tool yang relevan (user cuma menyapa, atau bertanya di luar topik sistem), jawab langsung tanpa memanggil tool.
- WAJIB hanya memanggil parameter yang benar-benar terdaftar di skema tool. JANGAN pernah menambah parameter yang tidak ada di skema (contoh: jangan kirim "search" ke tool yang skemanya tidak punya parameter search).
- Jika tidak ada tool yang relevan (user cuma menyapa, atau bertanya di luar topik sistem), jawab langsung tanpa memanggil tool.
- PENTING soal parameter cabang: baris "User yang bertanya: cabang ${user.cabang}" di atas HANYA informasi siapa yang login — JANGAN pernah pakai nilai itu sebagai filter cabang kecuali user secara eksplisit memintanya. Pertanyaan tanpa sebutan cabang (mis. "customer piutang terbanyak?", "penjualan hari ini?") artinya mencakup SEMUA cabang, kosongkan parameter cabang di tool.
- PENTING soal follow-up: kalau pertanyaan user melanjutkan/menegaskan topik dari pesan SEBELUMNYA di percakapan ini (mis. "yang paling laku yang mana?", "capai target dong berarti?", "kalau dibandingkan gimana?"), PERTAHANKAN cabang DAN periode yang sama dari pertanyaan sebelumnya — JANGAN reset ke semua cabang/KDC atau bulan berjalan kecuali user eksplisit menyebut cabang/periode - PENTING soal follow-up: kalau pertanyaan user melanjutkan/menegaskan topik dari pesan SEBELUMNYA di percakapan ini (mis. "yang paling laku yang mana?", "capai target dong berarti?", "kalau dibandingkan gimana?"), PERTAHANKAN cabang DAN periode yang sama dari pertanyaan sebelumnya — JANGAN reset ke semua cabang/KDC atau bulan berjalan kecuali user eksplisit menyebut cabang/periode baru.
- PENTING: kalau pertanyaan user cuma meminta KONFIRMASI/INTERPRETASI dari angka yang SUDAH ada di jawaban Anda sebelumnya (contoh: "berarti tidak capai target dong?", "artinya rugi ya?", "berarti stoknya cukup?"), JANGAN panggil tool lagi — cukup jawab langsung berdasarkan angka yang sudah Anda sebutkan di pesan sebelumnya di percakapan ini.
- Jika user minta BANDINGKAN 2 periode/bulan berbeda, panggil tool yang sama DUA KALI dalam satu balasan (satu per periode), masing-masing dengan period='custom' + startDate/endDate yang sesuai bulan itu.`;

    // 3. Riwayat percakapan dari frontend (sudah dibatasi 6 pesan terakhir di sana)
    let conversation = [
      { role: "system", content: systemPrompt },
      ...incomingMessages,
    ];

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
        if (!assistantMessage.content) {
          console.warn(
            "[AI] Model tidak balikin tool_calls maupun content. Raw:",
            JSON.stringify(assistantMessage),
          );
        }
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
          console.error(`[AI TOOL ERROR] ${fnName}:`, err.message);
          resultContent = { error: `Gagal mengambil data: ${err.message}` };
        }

        conversation.push({
          role: "tool",
          tool_call_id: call.id, // [FIX WAJIB] Groq (beda dari Ollama) mewajibkan ini,
          // kalau tidak ada, SEMUA request yang butuh Round 2 pasti gagal.
          name: fnName,
          content: JSON.stringify(resultContent),
        });
        executedResults.push({ fnName, args, resultContent });
      }

      // [OPTIMASI] Kalau cuma 1 tool dipanggil di putaran ini dan ada formatter
      // siap pakai, susun jawaban langsung di kode — skip 1 putaran LLM penuh
      // (hemat ~50s di setup CPU-only). Fallback ke LLM kalau formatter gagal
      // atau tool-nya belum punya template.
      if (executedResults.length === 1) {
        const { fnName, args, resultContent } = executedResults[0];
        const formatter = aiFormatters[fnName];
        if (formatter && !resultContent?.error) {
          try {
            return formatter(args, resultContent);
          } catch (fmtErr) {
            console.error(`[AI FORMATTER ERROR] ${fnName}:`, fmtErr.message);
          }
        }
      }
    }

    return "Maaf, permintaan ini terlalu kompleks untuk saya proses saat ini. Coba tanya lebih spesifik.";
  } catch (error) {
    console.error("[AI AGENT] Error processing message:", error);
    // [BARU] Pakai flag isRateLimit (lebih pasti) — sekalian tampilkan
    // detik tunggu asli dari Groq kalau tersedia, bukan angka tebakan.
    if (error.isRateLimit) {
      return error.message.replace("RATE_LIMIT: ", "");
    }
    return "Maaf, sistem AI sedang mengalami gangguan saat mengambil data. Silakan coba lagi nanti.";
  } finally {
    aiQueueService.releaseSlot();
  }
};

module.exports = {
  processMessage,
};
