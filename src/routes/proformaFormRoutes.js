const express = require("express");
const router = express.Router();
const controller = require("../controllers/proformaFormController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "28";

// Rute untuk mengambil data dari SO
router.get(
  "/from-so/:soNumber",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.getDataFromSO,
);

// Rute untuk mengambil data dari Invoice (sumber alternatif selain SO)
router.get(
  "/from-invoice/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.getDataFromInvoice,
);

// Rute untuk mengambil data saat form dalam mode 'Ubah'
router.get(
  "/:id",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.batasiAkses(),
  controller.getDataForEdit,
);

// Rute untuk menyimpan data baru (Create)
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.saveNew,
);

// Rute untuk memperbarui data yang ada (Update)
router.put(
  "/:id",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.batasiAkses(),
  controller.updateExisting,
);

router.get(
  "/lookup/so",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.lookupSO,
);

router.get(
  "/lookup/invoice",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.lookupInvoice,
);

router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.batasiAkses({ cetak: true }),
  controller.getPrintData,
);

module.exports = router;
