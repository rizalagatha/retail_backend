const express = require("express");
const router = express.Router();
const controller = require("../controllers/aiController");
const { verifyToken } = require("../middleware/authMiddleware");

// Chat AI
router.post("/chat", verifyToken, controller.chat);

module.exports = router;
