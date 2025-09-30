const express = require("express");
const router = express.Router();
const controller = require("../controllers/koreksiStokFormController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "25";

router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.getForEdit
);
router.post("/save", verifyToken, controller.save);
router.get(
  "/lookup/product-details",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getProductDetails
);

router.get(
  "/lookup/by-barcode/:barcode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.findByBarcode
);

router.get(
  "/lookup/products",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.lookupProducts
);

router.get("/print/:nomor", verifyToken, controller.getPrintData);

module.exports = router;
