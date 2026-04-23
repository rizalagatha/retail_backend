const express = require("express");
const router = express.Router();
const multer = require("multer");
const controller = require("../controllers/dtfMachineLogController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

// Menu ID untuk Log Mesin DTF
const MENU_ID = "62";

// Konfigurasi Multer (Simpan di RAM / Buffer sementara)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // Batasi ukuran file max 5MB
});

// GET: Ambil data untuk ditampilkan di tabel (Browse)
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getLogList,
);

// POST: Import file Excel dari log mesin
router.post(
  "/import",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  upload.single("file"),
  controller.importLogMesin,
);

module.exports = router;
