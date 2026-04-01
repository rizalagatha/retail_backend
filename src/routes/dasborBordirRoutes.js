const express = require("express");
const router = express.Router();
const dasborBordirController = require("../controllers/dasborBordirController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "57"; // Menu ID untuk Dasbor Bordir

// GET: Mengambil data utama dasbor (master grid)
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  dasborBordirController.getDasborData,
);

// GET: Mengambil data detail untuk satu tanggal (detail grid)
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  dasborBordirController.getDasborDetail,
);

// GET: Mengambil daftar cabang untuk filter
router.get(
  "/cabang-list",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  dasborBordirController.getCabangList,
);

// GET: Ekspor data header/master ke Excel
router.get(
  "/export-header",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  dasborBordirController.exportHeader,
);

// GET: Ekspor data detail gabungan ke Excel
router.get(
  "/export-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  dasborBordirController.exportDetail,
);

module.exports = router;
