const axios = require("axios");

const OLLAMA_URL =
  process.env.OLLAMA_URL || "http://103.93.162.0:11434/api/chat";
const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";

/**
 * Kirim request chat ke Ollama.
 * @param {Array} messages - riwayat percakapan (role: system/user/assistant/tool)
 * @param {Object} options - { temperature, tools, model }
 * @returns {Object} message object dari Ollama (berisi .content dan/atau .tool_calls)
 */
const sendChat = async (messages, options = {}) => {
  try {
    const payload = {
      model: options.model || MODEL,
      stream: false,
      messages,
      keep_alive: "30m",
      options: {
        temperature: options.temperature ?? 0.2,
        num_thread: 3,
        num_ctx: 4096,
      },
    };

    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools;
    }

    const { data } = await axios.post(OLLAMA_URL, payload);

    // Kembalikan message object utuh (bukan cuma .content) supaya caller
    // bisa cek apakah model minta panggil tool (.tool_calls).
    return data.message;
  } catch (err) {
    console.error("================ OLLAMA ERROR ================");
    console.error(err.response?.data || err.message);
    console.error(err.response?.status);
    console.error(err.response?.statusText);
    console.error("==============================================");

    throw new Error(err.response?.data?.error || err.message);
  }
};

module.exports = {
  sendChat,
};
