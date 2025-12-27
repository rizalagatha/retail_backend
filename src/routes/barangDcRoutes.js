const express = require("express");
const router = express.Router();
const controller = require("../controllers/barangDcController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "204";

// [FIX] Tambahkan Route Export di ATAS
router.get(
  "/export-headers",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.exportHeaders
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
router.get("/summary/total", verifyToken, controller.getTotalProducts);

// Route dengan parameter dinamis sebaiknya di bawah
router.get(
  "/details/:kode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetails
);

module.exports = router;
