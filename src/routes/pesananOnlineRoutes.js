const express = require("express");
const router = express.Router();
const controller = require("../controllers/pesananOnlineController");
const formController = require("../controllers/pesananOnlineFormController"); // Controller Form Simpan yang sebelumnya dibuat
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "56"; // Sesuai database

// 1. Browse / List History
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.index
);

// 2. Simpan Pesanan (Menggunakan controller form yang sebelumnya dibuat)
// Pastikan path controller savePesanan benar
router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  formController.savePesanan
);

module.exports = router;
