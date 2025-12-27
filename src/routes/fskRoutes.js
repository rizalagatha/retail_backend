const express = require("express");
const router = express.Router();
const controller = require("../controllers/formSetoranKasirController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "54";

// [PENTING] Route Export di ATAS
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
router.get(
  "/details/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetails
);
router.get(
  "/lookup/cabang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getCabangList
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.remove
);

module.exports = router;
