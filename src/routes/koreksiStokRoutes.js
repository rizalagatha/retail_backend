const express = require("express");
const router = express.Router();
const controller = require("../controllers/koreksiStokController.js");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "25";

// [FIX] PINDAHKAN INI KE PALING ATAS
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

router.post(
  "/toggle-approval/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.toggleApproval
);

router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.remove
);

module.exports = router;
