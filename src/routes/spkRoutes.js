// routes/spkRoutes.js
const express = require("express");
const router = express.Router();
const spkController = require("../controllers/spkController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

// Route lookup statis
router.get("/lookup/divisi", verifyToken, spkController.getDivisi);
router.get("/lookups", verifyToken, spkController.getLookups);

// [BARU] Route lookup dinamis berdasarkan Divisi
router.get(
  "/lookup/jenis-order/:divisi",
  verifyToken,
  spkController.getJenisOrder,
);

// Endpoint transaksi
router.post(
  "/generate-spk",
  verifyToken,
  checkPermission("26", "insert"), // Akses level Menu Surat Pesanan
  spkController.generateSpk,
);

module.exports = router;
