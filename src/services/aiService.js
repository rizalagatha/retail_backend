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

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const API_KEY = process.env.GROQ_API_KEY;
// Menggunakan model Llama 3 70B yang super pintar dan cepat
const MODEL = "llama-3.1-8b-instant";

const sendChat = async (messages, options = {}) => {
  try {
    const payload = {
      model: options.model || MODEL,
      stream: false,
      messages,
      temperature: options.temperature ?? 0.2,
      // [BARU] Batasi output — jawaban kita selalu pendek (beberapa kalimat/list
      // ≤10 baris), nggak perlu jatah token besar. Ini juga jaga-jaga model
      // nggak "ngoceh" panjang dan boros kuota 6000 tok/menit.
      max_tokens: 500,
    };

    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools;
    }

    const { data } = await axios.post(GROQ_URL, payload, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    return data.choices[0].message;
  } catch (err) {
    console.error("================ GROQ API ERROR ================");
    console.error(err.response?.data || err.message);
    console.error("================================================");

    if (err.response?.status === 429) {
      const retryAfter = err.response.headers?.["retry-after"];
      const waitMsg = retryAfter ? ` Coba lagi dalam ${retryAfter} detik.` : "";
      const rateLimitError = new Error(
        `RATE_LIMIT: Kuota Groq per menit habis.${waitMsg}`,
      );
      rateLimitError.isRateLimit = true;
      throw rateLimitError;
    }

    // [BARU] Model kadang salah format penutup tag function call sendiri
    // (mis. "<function>" bukan "</function>") — bug generasi model, bukan
    // salah skema/parameter kita. Tandai eksplisit supaya caller bisa retry
    // otomatis, karena percobaan ulang biasanya langsung berhasil.
    if (err.response?.data?.error?.code === "tool_use_failed") {
      const toolFormatError = new Error(
        "TOOL_FORMAT_ERROR: Groq gagal parse tool call.",
      );
      toolFormatError.isToolFormatError = true;
      throw toolFormatError;
    }

    throw new Error(err.response?.data?.error?.message || err.message);
  }
};

module.exports = {
  sendChat,
};
