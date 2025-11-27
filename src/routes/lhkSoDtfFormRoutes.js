const express = require("express");
const router = express.Router();
const lhkSoDtfFormController = require("../controllers/lhkSoDtfFormController");
const {
  verifyToken,
  checkPermission,
  checkInsertOrEditPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "41";

// PENTING: route spesifik harus di atas route param
router.get(
  "/search/so-po",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  lhkSoDtfFormController.searchSoPo
);

// POST save — aman
router.post(
  "/",
  verifyToken,
  checkInsertOrEditPermission(MENU_ID),
  lhkSoDtfFormController.saveData
);

// DELETE
router.delete(
  "/:tanggal/:cabang",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  lhkSoDtfFormController.removeData
);

// GET data by tanggal + cabang harus DI PALING BAWAH
router.get(
  "/:tanggal/:cabang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  lhkSoDtfFormController.loadData
);

module.exports = router;
