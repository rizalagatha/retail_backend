const express = require("express");
const router = express.Router();
const controller = require("../controllers/mutasiWorkshopController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "801";

// ==========================================
// ROUTE STATIS & LOOKUP (HARUS DI ATAS)
// ==========================================

router.get(
  "/export-details",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.exportData,
);

router.get(
  "/cabang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getCabangList,
);

router.get(
  "/list-workshop",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getWorkshopList,
);

// ==========================================
// ROUTE UTAMA & BERPARAMETER
// ==========================================

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getList,
);

router.get(
  "/details/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetails,
);

router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.remove,
);

module.exports = router;
