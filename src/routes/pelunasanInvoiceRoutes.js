const express = require("express");
const router = express.Router();
const controller = require("../controllers/pelunasanInvoiceController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

// ID Menu untuk permission (Misal menu baru id-nya '90' atau sesuaikan database)
// Gunakan 'view' untuk melihat, 'insert' untuk simpan.
const MENU_ID = "50";

// 1. Cari Piutang (Lookup)
router.get(
  "/outstanding-piutang/:customerKode",
  verifyToken,
  checkPermission(MENU_ID, "view"), // Aktifkan jika menu sudah ada di DB
  controller.getOutstandingPiutang
);

// 2. Simpan Pelunasan
router.post(
  "/save-pelunasan",
  verifyToken,
  checkPermission(MENU_ID, "insert"), // Aktifkan jika menu sudah ada di DB
  controller.savePelunasan
);

// [BARU] Browse History
router.get(
  "/history",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPaymentHistory
);

// [BARU] View Detail
router.get(
  "/detail/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPaymentDetail
);

module.exports = router;
