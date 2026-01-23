// routes/laporanListOtorisasiRoute.js

const express = require("express");
const router = express.Router();
const controller = require("../controllers/laporanListOtorisasiController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "502";

// Header: List utama (hanya AUTH)
router.get(
  "/list-otorisasi",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getListOtorisasi,
);

// Detail: Mengambil baris transaksi riil (INV) terkait
router.get(
  "/detail-transaksi",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetailTransaksi, // <--- Tambahkan ini
);

module.exports = router;
