const aiAgentService = require("../services/aiAgentService");
const aiChatHistoryService = require("../services/aiChatHistoryService");

const chat = async (req, res) => {
  try {
    // [BARU] sessionId opsional — kalau kosong berarti percakapan baru.
    // "messages" TETAP array trimmed dari frontend seperti sebelumnya
    // (dipakai apa adanya untuk konteks LLM, TIDAK diubah oleh fitur ini).
    const { messages, sessionId } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Parameter 'messages' wajib diisi (array).",
        });
    }

    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");

    // 1. Pastikan ada sesi — buat baru kalau belum ada
    let activeSessionId = sessionId || null;
    if (!activeSessionId) {
      activeSessionId = await aiChatHistoryService.createSession(
        req.user.kode,
        lastUserMsg?.content || "",
      );
    }

    // 2. Simpan pertanyaan user ke histori
    if (lastUserMsg) {
      await aiChatHistoryService.saveMessage(
        activeSessionId,
        "user",
        lastUserMsg.content,
      );
    }

    // 3. Proses jawaban AI seperti biasa (logic tool-calling TIDAK berubah)
    const answer = await aiAgentService.processMessage(messages, req.user);

    // 4. Simpan jawaban assistant ke histori
    await aiChatHistoryService.saveMessage(
      activeSessionId,
      "assistant",
      answer,
    );

    res.json({
      success: true,
      answer,
      sessionId: activeSessionId, // frontend simpan ini, dipakai lagi di request berikutnya
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// [BARU] List sesi chat milik user yang login — untuk sidebar "Recent Chats"
const listSessions = async (req, res) => {
  try {
    const sessions = await aiChatHistoryService.listSessions(req.user.kode);
    res.json({ success: true, data: sessions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// [BARU] Ambil histori pesan lengkap dari 1 sesi — untuk load ulang saat
// user klik salah satu chat lama di sidebar
const getSession = async (req, res) => {
  try {
    const { id } = req.params;
    const messages = await aiChatHistoryService.getSessionMessages(
      id,
      req.user.kode,
    );
    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(404).json({ success: false, message: err.message });
  }
};

// [BARU] Hapus sesi chat
const deleteSession = async (req, res) => {
  try {
    const { id } = req.params;
    await aiChatHistoryService.deleteSession(id, req.user.kode);
    res.json({ success: true, message: "Sesi chat berhasil dihapus." });
  } catch (err) {
    res.status(404).json({ success: false, message: err.message });
  }
};

module.exports = {
  chat,
  listSessions,
  getSession,
  deleteSession,
};
