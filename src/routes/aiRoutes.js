const express = require("express");
const router = express.Router();
const controller = require("../controllers/aiController");
const { verifyToken } = require("../middleware/authMiddleware");

// Chat AI
router.post("/chat", verifyToken, controller.chat);

// [BARU] Riwayat percakapan (Recent Chats)
router.get("/sessions", verifyToken, controller.listSessions);
router.get("/sessions/:id", verifyToken, controller.getSession);
router.delete("/sessions/:id", verifyToken, controller.deleteSession);

module.exports = router;
