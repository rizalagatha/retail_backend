const express = require("express");
const router = express.Router();
const controller = require("../controllers/packingListFormController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "224"; // ID Menu untuk Packing List

// --- Static Routes (Letakkan di atas Dynamic Routes) ---

// 1. Load item dari Nomor Permintaan Store
// Endpoint: GET /api/packing-list-form/load-request?nomor=...
router.get(
  "/load-request",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.loadItemsFromRequest
);

// 2. Cari Barang by Barcode untuk Scan
// Endpoint: GET /api/packing-list-form/barcode/:barcode
router.get(
  "/barcode/:barcode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.findByBarcode
);

// 3. Simpan Data (Baru & Edit)
// Endpoint: POST /api/packing-list-form/save
router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.saveData
);

// --- Dynamic Routes (Letakkan di paling bawah) ---

// 4. Ambil Data Detail untuk Mode Edit
// Endpoint: GET /api/packing-list-form/:nomor
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getById
);

router.get(
  "/print-data/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrintData
);

module.exports = router;
