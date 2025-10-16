const express = require("express");
const router = express.Router();
const controller = require("../controllers/laporanListOtorisasiController");
const { verifyToken, checkPermission } = require("../middleware/authMiddleware");

const MENU_ID = "502";

// GET /api/laporan/list-otorisasi?startDate=2025-10-01&endDate=2025-10-09
router.get(
  "/list-otorisasi",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getListOtorisasi
);

module.exports = router;
