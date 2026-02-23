const express = require("express");
const router = express.Router();
const terimaSjController = require("../controllers/terimaSjController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "31"; // Menu ID untuk Terima SJ

// --- Endpoint Browse & Lookup ---
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  terimaSjController.getList,
);
router.get(
  "/details/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  terimaSjController.getDetails,
);
router.get(
  "/lookup/cabang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  terimaSjController.getCabangList,
);
router.get(
  "/export-details",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  terimaSjController.exportDetails,
);

// --- Endpoint Aksi ---
router.delete(
  "/:nomorSj/:nomorTerima",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  terimaSjController.remove,
);

/**
 * [BARU] Endpoint Pemicu Eksekusi Otomatis H+2
 * Digunakan untuk menjalankan proses 'Auto-Receive' secara manual dari web.
 * Akses dibatasi untuk level 'view' (atau bisa disesuaikan ke 'insert').
 */
router.post(
  "/auto-receive-trigger",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  terimaSjController.runAutoReceive,
);

module.exports = router;
