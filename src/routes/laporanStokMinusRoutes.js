// src/routes/laporanStokMinusRoute.js

const express = require("express");
const router = express.Router();
const controller = require("../controllers/laporanStokMinusController");
const { verifyToken } = require("../middleware/authMiddleware");

// GET /api/laporan/stok-minus/
router.get("/", verifyToken, controller.getLaporan);

// GET /api/laporan/stok-minus/lookup/cabang
router.get("/lookup/cabang", verifyToken, controller.getCabangOptions);

module.exports = router;
