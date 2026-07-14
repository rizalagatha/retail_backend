const aiService = require("./aiService");
const dashboardService = require("./dashboardService");
const { buildTools } = require("../config/aiTools");
const { SYSTEM_PROMPT } = require("../config/aiPrompt");
const aiFormatters = require("../config/aiFormatters");
const aiQueueService = require("./aiQueueService");
const { format } = require("date-fns");

const MAX_TOOL_ROUNDS = 2;

const processMessage = async (incomingMessages, user) => {
  const { waitingCount } = aiQueueService.getQueueStatus();
  const queuedAtStart = waitingCount; // posisi antrian SEBELUM slot didapat

  await aiQueueService.acquireSlot(); // nunggu di sini kalau 3 slot lagi penuh

  try {
    // 1. Ambil daftar cabang dari DB (bukan hardcode) untuk enum parameter tool
    const cabangOptions = await dashboardService.getCabangOptions(user);
    const { tools, executors } = buildTools(user, cabangOptions);

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
- Jika ada tool yang relevan untuk menjawab pertanyaan, WAJIB gunakan tool tersebut. Jangan menjawab dari ingatan/tebakan.
- Jika tidak ada tool yang relevan (user cuma menyapa, atau bertanya di luar topik sistem), jawab langsung tanpa memanggil tool.`;

    // 3. Riwayat percakapan dari frontend (sudah dibatasi 6 pesan terakhir di sana)
    let conversation = [
      { role: "system", content: systemPrompt },
      ...incomingMessages,
    ];

    // 4. Loop tool-calling
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const t0 = Date.now();
      console.log(`[AI] Round ${round + 1}/${MAX_TOOL_ROUNDS}...`);
      const assistantMessage = await aiService.sendChat(conversation, {
        temperature: 0.2,
        tools,
      });
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
    return "Maaf, sistem AI sedang mengalami gangguan saat mengambil data. Silakan coba lagi nanti.";
  } finally {
    aiQueueService.releaseSlot();
  }
};

module.exports = {
  processMessage,
};
