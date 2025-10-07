const express = require("express");
const router = express.Router();
const controller = require("../controllers/pengajuanBarcodeFormController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "33";

// GET: Mengambil data untuk form mode ubah
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.getForEdit
);

// POST: Menyimpan data baru atau yang sudah diubah
router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, ["insert", "edit"]),
  controller.save
);

router.get(
  "/lookup/products",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.lookupProducts
);

router.get("/lookup/jenis-reject", verifyToken, controller.getJenisReject);

router.get(
  "/lookup/product-details",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getProductDetails
);

router.get(
  "/lookup/stickers",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.lookupStickers
);

router.get(
  "/print-barcode/:nomor",
  verifyToken,
  controller.getDataForBarcodePrint
);

// Tambahkan endpoint lain jika diperlukan, misal untuk lookup produk, upload gambar, dll.

module.exports = router;
