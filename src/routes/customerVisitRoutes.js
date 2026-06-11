const express = require("express");
const router = express.Router();
const controller = require("../controllers/customerVisitController");
const { verifyToken } = require("../middleware/authMiddleware");

// Endpoint: GET /api/customer-visit/check
router.get("/check", verifyToken, controller.checkVisitToday);

module.exports = router;
