const express = require("express");
const router = express.Router();
const controller = require("../controllers/laporanPenjualanPivotController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "506";

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getSalesData,
);
router.get(
  "/aggregated",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getAggregated,
);
router.get(
  "/chart-data",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getChartData,
);

module.exports = router;
