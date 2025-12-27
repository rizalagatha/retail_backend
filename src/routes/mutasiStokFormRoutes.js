const express = require("express");
const router = express.Router();
const controller = require("../controllers/mutasiStokFormController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "45";

const checkSavePermission = (req, res, next) => {
  const action = req.body.isNew ? "insert" : "edit";
  return checkPermission(MENU_ID, action)(req, res, next);
};

// [FIX] PINDAHKAN INI KE ATAS
router.get(
  "/export-details",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.exportDetails
);

// Mencari SO yang valid untuk dimuat
router.get(
  "/search/so",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchSo
);

// Memuat detail item dari SO yang dipilih
router.get(
  "/load-from-so/:nomorSo",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.loadFromSo
);

router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrintData
);

// Memuat data Mutasi Stok yang sudah ada untuk mode "Ubah" (Wildcard Parameter)
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.loadForEdit
);

// Menyimpan data (baru atau yang diubah)
router.post("/save", verifyToken, checkSavePermission, controller.save);

module.exports = router;
