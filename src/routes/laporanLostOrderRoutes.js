const express = require("express");
const router = express.Router();
const controller = require("../controllers/laporanLostOrderController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "514";

// Endpoint mendapatkan data laporan lost order dengan proteksi hak akses view
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getLostOrderReport,
);

module.exports = router;
