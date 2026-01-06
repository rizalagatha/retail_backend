const express = require("express");
const router = express.Router();
const controller = require("../controllers/biayaKirimController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "49";

// Ambil daftar biaya kirim (Browse)
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBrowse
);

// Ambil detail pembayaran per nomor biaya kirim
router.get(
  "/details/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetails
);

// Hapus data biaya kirim
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deleteData
);

module.exports = router;
