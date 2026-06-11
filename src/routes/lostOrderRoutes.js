const express = require("express");
const router = express.Router();
const controller = require("../controllers/lostOrderController");
const { verifyToken } = require("../middleware/authMiddleware");

// Hanya perlu token login untuk mencatat Lost Order
router.post("/", verifyToken, controller.createLostOrder);

// Mengambil data (Bisa ditambahkan checkPermission jika nanti ada menu khusus)
router.get("/", verifyToken, controller.getLostOrders);

module.exports = router;
