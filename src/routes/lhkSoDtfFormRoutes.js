const express = require("express");
const router = express.Router();
const lhkSoDtfFormController = require("../controllers/lhkSoDtfFormController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "41"; // ID Menu LHK SO DTF

// 🟢 Pindahkan ini ke paling atas supaya tidak ketangkap oleh /:tanggal/:cabang
router.get(
  "/search/so-po",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  lhkSoDtfFormController.searchSoPo
);

// GET: Memuat semua data LHK untuk tanggal dan cabang tertentu
router.get(
  "/:tanggal/:cabang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  lhkSoDtfFormController.loadData
);

// POST: Menyimpan seluruh data LHK untuk satu hari (delete-then-insert)
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, ["insert", "edit"]),
  lhkSoDtfFormController.saveData
);

// DELETE
router.delete(
  "/:tanggal/:cabang",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  lhkSoDtfFormController.removeData
);

module.exports = router;
