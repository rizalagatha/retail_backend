const express = require("express");
const router = express.Router();
const controller = require("../controllers/biayaKirimFormController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "49";

const checkSavePermission = (req, res, next) => {
  const action = req.body.isNew ? "insert" : "edit";
  return checkPermission(MENU_ID, action)(req, res, next);
};

// Integrasi Lookup Invoice
router.get("/lookup/invoice", verifyToken, controller.lookupInvoice);
router.get(
  "/invoice-details/:nomorInv",
  verifyToken,
  controller.getInvoiceDetails
);

// Mode Ubah: Load data BK yang sudah ada
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.loadForEdit
);

// Simpan & Hapus
router.post("/save", verifyToken, checkSavePermission, controller.save);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.remove
);

// GET: Data khusus untuk tampilan cetak
router.get('/print/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getPrintData);

module.exports = router;
