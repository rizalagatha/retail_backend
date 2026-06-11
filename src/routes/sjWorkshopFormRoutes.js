const express = require("express");
const router = express.Router();
const controller = require("../controllers/sjWorkshopFormController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "803";

router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.save,
);
router.get(
  "/by-barcode/:barcode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getByBarcode,
);
router.get(
  "/lookup/so-lhk",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchSoBordirSelesai,
);
router.get(
  "/lookup/items-from-so",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getItemsFromSo,
);
router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrintData,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.loadForEdit,
);

module.exports = router;
