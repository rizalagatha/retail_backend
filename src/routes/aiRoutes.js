const express = require("express");
const router = express.Router();
const controller = require("../controllers/aiController");
const { verifyToken } = require("../middleware/authMiddleware");

// [BARU] Impor middleware rate limiter yang sudah dibuat
const aiRateLimiter = require("../middleware/aiRateLimiter");

// Chat AI - Sisipkan aiRateLimiter setelah verifyToken
router.post("/chat", verifyToken, aiRateLimiter, controller.chat);

// Riwayat percakapan (Recent Chats) - Tidak perlu dilimit karena tidak memanggil API LLM
router.get("/sessions", verifyToken, controller.listSessions);
router.get("/sessions/:id", verifyToken, controller.getSession);
router.delete("/sessions/:id", verifyToken, controller.deleteSession);

module.exports = router;
