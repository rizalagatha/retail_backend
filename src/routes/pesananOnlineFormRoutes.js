const express = require("express");
const router = express.Router();
const controller = require("../controllers/pesananOnlineFormController");
const { verifyToken } = require("../middleware/authMiddleware");

router.get("/gudang-options", verifyToken, controller.getGudangOptions);

// [BARU] Cek Stok Batch/Single
router.post("/check-stock", verifyToken, controller.checkStock);

// Endpoint untuk menyimpan pesanan (Mutasi + Invoice)
// URL: /api/v1/pesanan-online/save
router.post("/save", verifyToken, controller.savePesanan);

module.exports = router;