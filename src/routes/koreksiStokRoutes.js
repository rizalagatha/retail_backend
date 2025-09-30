const express = require("express");
const router = express.Router();
const controller = require("../controllers/koreksiStokController.js");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "25";

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
); // Asumsi hak 'edit' untuk ACC

// Tambahkan route DELETE jika diperlukan nanti
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.remove
);

router.get(
  "/export-details",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.exportDetails
);

module.exports = router;
