const aiAgentService = require("../services/aiAgentService");

const chat = async (req, res) => {
  try {
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Parameter 'messages' wajib diisi (array).",
      });
    }

    const answer = await aiAgentService.processMessage(messages, req.user);

    res.json({
      success: true,
      answer,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

module.exports = {
  chat,
};
