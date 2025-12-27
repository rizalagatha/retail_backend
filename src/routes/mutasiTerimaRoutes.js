const express = require("express");
const router = express.Router();
const controller = require("../controllers/mutasiTerimaController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "47";

// [FIX] PINDAHKAN KE PALING ATAS
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
router.get(
  "/details/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetails
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.cancelReceipt
);

module.exports = router;
