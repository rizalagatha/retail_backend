const express = require("express");
const upload = require('../middleware/uploadMiddleware');
const router = express.Router();
const controller = require("../controllers/pengajuanBarcodeFormController");
const {
  verifyToken,
  checkPermission,
  checkSavePermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "33";

// --- ROUTE SPESIFIK (HARUS DI ATAS) ---

// Lookup & Utils
router.get("/lookup/products", verifyToken, checkPermission(MENU_ID, "view"), controller.lookupProducts);
router.get("/lookup/jenis-reject", verifyToken, controller.getJenisReject);
router.get("/lookup/product-details", verifyToken, checkPermission(MENU_ID, "view"), controller.getProductDetails);
router.get("/lookup/stickers", verifyToken, checkPermission(MENU_ID, "view"), controller.lookupStickers);

// Upload
router.post("/save", verifyToken, checkSavePermission(MENU_ID), controller.save);
router.post("/upload-item-image", verifyToken, upload.single('image'), checkPermission(MENU_ID, "edit"), controller.uploadItemImage);

// Print
router.get("/print-barcode/:nomor", verifyToken, controller.getDataForBarcodePrint);

// --- PERBAIKAN: Route Print A4 ditaruh di sini (sebelum /:nomor) ---
router.get(
  "/print-a4/:nomor", 
  verifyToken, 
  // checkPermission(MENU_ID, "view"), // Aktifkan jika perlu cek izin
  controller.getDataForPrint
);

// --- ROUTE GENERIK (HARUS PALING BAWAH) ---
// Route ini menangkap sembarang string setelah slash (misal: K06.RJT...)
// Jika ditaruh di atas, dia akan memakan request ke /lookup, /print, dll.
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.getForEdit
);

module.exports = router;