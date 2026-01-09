const express = require("express");
const router = express.Router();
const controller = require("../controllers/peminjamanController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "56";

// Ambil Daftar Peminjaman (Browse)
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getList
);

// Ambil Detail Peminjaman (Expand/Edit)
router.get(
  "/details",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetails
);

// Lookup Barang (Sama seperti Ambil Barang)
router.get(
  "/lookup/products",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.lookupProducts
);

// Simpan Peminjaman Baru atau Update
router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.savePeminjaman
);

// Hapus Peminjaman
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deletePeminjaman
);

module.exports = router;
