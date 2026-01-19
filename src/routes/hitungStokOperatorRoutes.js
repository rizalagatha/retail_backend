const express = require("express");
const router = express.Router();
const controller = require("../controllers/hitungStokOperatorController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "19";

// Endpoint utama untuk mengambil data list
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getList
);

// Endpoint untuk pilihan cabang di filter
router.get(
  "/cabang-options",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getCabangOptions
);

module.exports = router;
