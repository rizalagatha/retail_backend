const express = require("express");
const router = express.Router();
const perencanaanProduksiController = require("../controllers/perencanaanProduksiController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = 254; // Menu ID DC Planning

router.get(
  "/priority",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  perencanaanProduksiController.getPriorityList,
);
router.get(
  "/store-details",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  perencanaanProduksiController.getStoreDetails,
);
router.get(
  "/kepentingan-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  perencanaanProduksiController.getKepentinganOptions,
);
router.get(
  "/dateline-range",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  perencanaanProduksiController.getDatelineRange,
);
router.get(
  "/spk-beredar-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  perencanaanProduksiController.spkBeredarDetail,
);
router.post(
  "/generate-spk-bulk",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  perencanaanProduksiController.generateBulkSpk,
);

module.exports = router;
