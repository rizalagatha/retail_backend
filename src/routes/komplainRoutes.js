const express = require("express");
const router = express.Router();
const controller = require("../controllers/komplainController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware"); // Sesuaikan path jika folder Anda bernama 'middlewares' (pakai 's')

const MENU_ID = "60";

// Ambil Daftar Komplain (Browse)
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getList,
);

// (Nanti rute lain seperti GET detail atau DELETE bisa ditambahkan di sini jika dibutuhkan di form browse)

module.exports = router;
