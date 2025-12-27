const express = require("express");
const router = express.Router();
const controller = require("../controllers/potonganController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "53";

// [FIX] Pindahkan Export ke ATAS dan samakan URL dengan frontend
router.get(
  "/export-details",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.exportPotonganDetails
);

// [BARU] Tambahkan route untuk Export Header
router.get(
  "/export-headers",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.exportPotonganHeaders
);

// Route lainnya
router.get(
  "/lookup/cabang-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getCabangList
);
router.get(
  "/master",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPotonganList
);
router.get(
  "/browse-details/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowseDetails
);
router.get(
  "/detail/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPotonganDetails
);
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.savePotongan
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.savePotongan
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deletePotongan
);

module.exports = router;
