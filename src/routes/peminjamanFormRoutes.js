const express = require("express");
const router = express.Router();
const controller = require("../controllers/peminjamanFormController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "56";

router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrintData
);

router.get(
  "/lookup/products",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.lookupProducts
);

// Lookup Produk (Scan Barcode/Enter)
router.get(
  "/lookup/product-by-barcode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.lookupProductByBarcode
);

// Simpan/Update
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.saveData
);
router.put(
  "/:id",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.saveData
);

module.exports = router;
