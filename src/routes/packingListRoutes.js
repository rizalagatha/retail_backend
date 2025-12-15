const express = require("express");
const router = express.Router();
const controller = require("../controllers/packingListController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

// Ganti MENU_ID dengan ID menu baru untuk Packing List di database permission Anda
const MENU_ID = "224";

// Static Routes First
router.get(
  "/lookup/cabang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getCabangList
);
router.get(
  "/export-details",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.exportDetails
);
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getList
);

// Dynamic Routes
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetails
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.remove
);

module.exports = router;
