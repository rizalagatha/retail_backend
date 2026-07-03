const express = require("express");
const router = express.Router();
const bufferPanelController = require("../controllers/bufferPanelController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "63"; // Menu ID untuk Panel Setting Buffer Stok

// GET: Mengambil data mentah (Average penjualan terkini vs tahun lalu)
router.get(
  "/preview",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  bufferPanelController.getPreview,
);

router.get(
  "/detail-spk",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  bufferPanelController.getDetailSpk,
);

// POST: Menyimpan hasil hitungan (Min, Max) ke database
router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "edit"), // Syaratnya harus bisa edit
  bufferPanelController.saveSettings,
);

router.get(
  "/config",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  bufferPanelController.getConfig,
);
router.post(
  "/config",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  bufferPanelController.saveConfig,
);
router.get(
  "/stok-per-cabang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  bufferPanelController.getStokPerCabang,
);
router.get(
  "/sesional",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  bufferPanelController.getSesionalItems,
);
router.post(
  "/sesional",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  bufferPanelController.saveSesionalItems,
);

router.post(
  "/generate-log",
  verifyToken,
  checkPermission(MENU_ID, "edit"), // Bisa dikunci khusus level admin
  bufferPanelController.triggerGenerateLog,
);

module.exports = router;
