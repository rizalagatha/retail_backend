const express = require("express");
const router = express.Router();
const controller = require("../controllers/laporanStokMinusController");
const { verifyToken } = require("../middleware/authMiddleware");

// GET /api/laporan/stok-minus/
// Mengambil data header barang yang minus
router.get("/", verifyToken, controller.getLaporan);

// GET /api/laporan/stok-minus/details
// [TAMBAHAN] Mengambil detail transaksi penyebab minus
router.get("/details", verifyToken, controller.getDetails);

// GET /api/laporan/stok-minus/lookup/cabang
router.get("/lookup/cabang", verifyToken, controller.getCabangOptions);

module.exports = router;
