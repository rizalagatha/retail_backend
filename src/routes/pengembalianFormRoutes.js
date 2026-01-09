const express = require("express");
const router = express.Router();
const controller = require("../controllers/pengembalianFormController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "56"; // Samakan dengan Menu Peminjaman

router.get(
  "/loan/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPinjamanData
);
router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.saveReturn
);

module.exports = router;
