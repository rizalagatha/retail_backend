const express = require("express");
const router = express.Router();
const controller = require("../controllers/terimaWorkshopController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "802";

// Rute Statis
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getList,
);
router.get(
  "/export-details",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.exportDetails,
);

// Rute Dinamis Parameter (Letakkan di bawah)
router.get(
  "/details/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetails,
);
router.post(
  "/:nomor/cancel",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.cancelReceipt,
);

module.exports = router;
