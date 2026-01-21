const express = require("express");
const router = express.Router();
const controller = require("../controllers/returDcFormController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "32"; // Menu ID untuk Retur Barang ke DC

// GET: Mengambil semua item yang memiliki stok untuk di-load ke grid
router.get(
  "/load-all-stock",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.loadAllStock,
);

// GET: Mengambil data retur yang sudah ada untuk mode ubah
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.getForEdit,
);

// POST: Menyimpan data retur baru atau yang diubah
router.post("/save", verifyToken, controller.save);

// GET: Lookup untuk detail produk tunggal (digunakan oleh F1/F2)
router.get(
  "/lookup/product-details",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getProductDetails,
);

// GET: Lookup untuk mencari produk via scan barcode
router.get(
  "/lookup/by-barcode/:barcode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.findByBarcode,
);

router.get(
  "/lookup/gudang-dc",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.lookupGudangDc,
);

// Lookup daftar nomor Retur Jual Online khusus KON
router.get(
  "/lookup/retur-jual-kon",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.lookupReturJualKON,
);

// Load detail item berdasarkan nomor RJ yang dipilih
router.get(
  "/load-from-rj/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.loadFromRJ,
);

router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrintData,
);

module.exports = router;
