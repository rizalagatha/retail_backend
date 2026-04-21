const express = require("express");
const router = express.Router();
const soDtfTrialController = require("../controllers/soDtfTrialController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "61";

// Mendapatkan daftar SO DTF Trial
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  soDtfTrialController.getList,
);

// Mengekspor Detail SO DTF Trial ke Excel
router.post(
  "/export-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  soDtfTrialController.exportDetail,
);

// Menutup SO DTF Trial
router.post(
  "/close",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  soDtfTrialController.closeSo,
);

// Menghapus SO DTF Trial
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  soDtfTrialController.remove,
);

// Mendapatkan rincian item berdasarkan nomor SO DTF Trial
// Route dengan param dinamis ditaruh paling bawah agar tidak menimpa route lain
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  soDtfTrialController.getDetails,
);

module.exports = router;
