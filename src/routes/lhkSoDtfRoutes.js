const express = require("express");
const router = express.Router();
const lhkSoDtfController = require("../controllers/lhkSoDtfController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "41";

// GET: Daftar Utama LHK (Header)
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  lhkSoDtfController.getAll,
);

// GET: Rincian SO di dalam satu LHK (Detail)
router.get(
  "/detail-list/:nomorLhk",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  lhkSoDtfController.getDetailList,
);

// GET: Daftar cabang untuk filter
router.get(
  "/cabang-list",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  lhkSoDtfController.getCabangList,
);

// DELETE: Hapus satu bundel LHK berdasarkan nomor
router.delete(
  "/:nomorLhk",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  lhkSoDtfController.remove,
);

module.exports = router;
