const express = require("express");
const router = express.Router();
const controller = require("../controllers/mintaAccesoriesFormController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "225";

// --- Cari Barang (Pencarian Modal) ---
router.get(
  "/search-barang",
  verifyToken,
  checkPermission(MENU_ID, "view"), // Setidaknya punya akses view ke menu ini
  controller.searchBarang,
);

// --- Load Data untuk Edit ---
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.loadData,
);

// --- Simpan Data (Create & Update) ---
// Kita gabungkan izin insert/edit, backend akan mendeteksi dari flag 'isNew'
router.post(
  "/save",
  verifyToken,
  // Abaikan validasi spesifik di sini, pastikan frontend mengatur izin
  controller.saveData,
);

module.exports = router;
