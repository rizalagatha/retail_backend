const express = require("express");
const router = express.Router();
const reportController = require("../controllers/pettyCashReportController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

// Menu ID untuk Laporan Mutasi Petty Cash adalah 603
const MENU_ID = "603";

router.get(
  "/cabang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  reportController.getCabangList,
);

/**
 * @route   GET /api/petty-cash-report
 * @desc    Mengambil data mutasi debet kredit (Buku Besar) per cabang
 * @access  Private (Verify Token & Permission Read)
 */
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  reportController.getReport,
);

module.exports = router;
