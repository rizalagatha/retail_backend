const express = require("express");
const router = express.Router();
const controller = require("../controllers/laporanStokBahanController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "513";

// Opsi cabang untuk dropdown filter
router.get(
  "/cabang-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getCabangOptions,
);

// Laporan stok ringkasan per barang
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getStokBahan,
);

// Kartu stok detail per kode barang (FIXED ROUTE)
router.get(
  "/kartu-stok",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getKartuStokBahan,
);

module.exports = router;
