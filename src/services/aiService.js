// const axios = require("axios");

// const OLLAMA_URL =
//   process.env.OLLAMA_URL || "http://103.93.162.0:11434/api/chat";
// const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";

// /**
//  * Kirim request chat ke Ollama.
//  * @param {Array} messages - riwayat percakapan (role: system/user/assistant/tool)
//  * @param {Object} options - { temperature, tools, model }
//  * @returns {Object} message object dari Ollama (berisi .content dan/atau .tool_calls)
//  */
// const sendChat = async (messages, options = {}) => {
//   try {
//     const payload = {
//       model: options.model || MODEL,
//       stream: false,
//       messages,
//       keep_alive: "30m",
//       options: {
//         temperature: options.temperature ?? 0.2,
//         num_thread: 3,
//         num_ctx: 6144,
//       },
//     };

//     if (options.tools && options.tools.length > 0) {
//       payload.tools = options.tools;
//     }

//     const { data } = await axios.post(OLLAMA_URL, payload);

//     // Kembalikan message object utuh (bukan cuma .content) supaya caller
//     // bisa cek apakah model minta panggil tool (.tool_calls).
//     return data.message;
//   } catch (err) {
//     console.error("================ OLLAMA ERROR ================");
//     console.error(err.response?.data || err.message);
//     console.error(err.response?.status);
//     console.error(err.response?.statusText);
//     console.error("==============================================");

//     throw new Error(err.response?.data?.error || err.message);
//   }
// };

// module.exports = {
//   sendChat,
// };

const axios = require("axios");

// Gunakan URL dan model Claude yang valid
const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const API_KEY = process.env.CLAUDE_API_KEY;
const MODEL = "claude-haiku-4-5-20251001"; // Versi Haiku terbaru

const sendChat = async (messages, options = {}) => {
  try {
    // 2. Mapping format pesan OpenAI -> Anthropic (tidak perlu filter role
    // "system" lagi karena system sekarang dikirim terpisah lewat options)
    const chatMessages = messages.map((msg) => {
      // Mapping balasan eksekusi tool
      if (msg.role === "tool") {
        return {
          role: "user", // Di Claude, hasil tool dikirim sebagai role "user"
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.tool_call_id,
              content: msg.content,
            },
          ],
        };
      }

      // Mapping AI yang memanggil tool di histori sebelumnya
      if (msg.role === "assistant" && msg.tool_calls) {
        const content = [];
        if (msg.content) content.push({ type: "text", text: msg.content });

        msg.tool_calls.forEach((call) => {
          content.push({
            type: "tool_use",
            id: call.id,
            name: call.function.name,
            input:
              typeof call.function.arguments === "string"
                ? JSON.parse(call.function.arguments)
                : call.function.arguments,
          });
        });
        return { role: "assistant", content };
      }

      // Pesan teks biasa
      return { role: msg.role, content: msg.content };
    });

    // 3. Mapping format skema Tool (parameters -> input_schema)
    const claudeTools = options.tools
      ? options.tools.map((t, idx, arr) => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters,
          ...(idx === arr.length - 1
            ? { cache_control: { type: "ephemeral" } }
            : {}),
        }))
      : undefined;

    // [UBAH] System sekarang array 2 blok: blok stabil di-cache (TTL 1 jam,
    // karena traffic AI ini kemungkinan tidak sepadat traffic umum — TTL
    // lebih panjang dari default 5 menit mengurangi resiko cache expired
    // di antara pertanyaan-pertanyaan user yang jaraknya agak lama),
    // blok dinamis TIDAK di-cache (percuma di-cache karena isinya emang
    // beda tiap request, cuma nambah write-premium tanpa manfaat).
    const systemBlocks = [];
    if (options.systemStable) {
      systemBlocks.push({
        type: "text",
        text: options.systemStable,
        cache_control: { type: "ephemeral", ttl: "1h" },
      });
    }
    if (options.systemDynamic) {
      systemBlocks.push({
        type: "text",
        text: options.systemDynamic,
        // sengaja TANPA cache_control
      });
    }

    const payload = {
      model: options.model || MODEL,
      system: systemBlocks,
      messages: chatMessages,
      max_tokens: 1500,
      temperature: options.temperature ?? 0.2,
    };

    if (claudeTools && claudeTools.length > 0) {
      payload.tools = claudeTools;
    }

    // 4. Hit API Claude
    const { data } = await axios.post(CLAUDE_URL, payload, {
      headers: {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        // [DIHAPUS] "anthropic-beta": "prompt-caching-2024-07-31" — prompt
        // caching sekarang didukung langsung lewat cache_control tanpa
        // beta header, header lama ini kemungkinan cuma jadi no-op.
      },
    });

    // 5. Mapping balik response Claude -> format OpenAI (agar aiAgentService.js aman)
    const assistantMessage = { role: "assistant", content: "" };
    const toolCalls = [];

    data.content.forEach((block) => {
      if (block.type === "text") {
        assistantMessage.content += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input), // Kembalikan ke format stringified JSON
          },
        });
      }
    });

    if (toolCalls.length > 0) {
      assistantMessage.tool_calls = toolCalls;
    }

    return assistantMessage;
  } catch (err) {
    console.error("================ CLAUDE API ERROR ================");
    console.error(err.response?.data?.error?.message || err.message);
    console.error("==================================================");

    if (err.response?.status === 429) {
      const rateLimitError = new Error(
        "RATE_LIMIT: Kuota Claude per menit habis.",
      );
      rateLimitError.isRateLimit = true;
      throw rateLimitError;
    }

    throw new Error(err.response?.data?.error?.message || err.message);
  }
};

module.exports = {
  sendChat,
};
