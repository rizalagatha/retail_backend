const express = require("express");
const router = express.Router();
const controller = require("../controllers/mutasiWorkshopFormController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "801"; // Mutasi ke Workshop

// ==========================================
// ROUTE STATIS & LOOKUP (HARUS DI ATAS)
// ==========================================

router.get(
  "/tujuan-workshop",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.lookupTujuanWorkshop,
);

router.get(
  "/lookup-products",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.lookupProducts,
);

router.get(
  "/product-details",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.getProductDetails,
);

router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.save,
);

// ==========================================
// ROUTE BERPARAMETER DINAMIS
// ==========================================

router.get(
  "/by-barcode/:barcode",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.findByBarcode,
);

router.get(
  "/print-data/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrintData,
);

router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.getForEdit,
);

module.exports = router;
