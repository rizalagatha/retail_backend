const express = require("express");
const router = express.Router();
const barcodeFormController = require("../controllers/barcodeFormController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

// GET /api/barcode-form/next-number -> Mendapatkan nomor transaksi baru
router.get(
  "/next-number",
  verifyToken,
  checkPermission,
  barcodeFormController.getNextNumber
);

// GET /api/barcode-form/search-products -> Mencari produk
router.get(
  "/search-products",
  verifyToken,
  checkPermission,
  barcodeFormController.searchProducts
);
router.get(
  "/master-search",
  verifyToken,
  checkPermission,
  barcodeFormController.searchMaster
);

// GET /api/barcode-form/product-details/:productCode -> Mendapatkan detail ukuran & barcode produk
router.get(
  "/product-details/:productCode",
  verifyToken,
  checkPermission,
  barcodeFormController.getProductDetails
);

router.get(
  '/lookup/by-barcode/:barcode',
  verifyToken,
  checkPermission, // Pastikan route ini dilindungi
  barcodeFormController.findByBarcode
);

// POST /api/barcode-form/save -> Menyimpan data barcode baru
router.post("/save", verifyToken, checkPermission, barcodeFormController.save);

module.exports = router;
