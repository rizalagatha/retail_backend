const express = require("express");
const router = express.Router();
const controller = require("../controllers/komplainFormController");
const upload = require("../middleware/uploadMiddleware"); // Sesuaikan path jika namanya beda
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "60";

// 1. Ambil Detail Komplain (Untuk halaman edit/view)
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetail,
);

// 2. Simpan Komplain (DRAFT mode)
router.post(
  "/save",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.save,
);

router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrintData,
);

// 3. Ubah Status Tiket & Insert Log
router.put(
  "/:nomor/status",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.changeStatus,
);

// 4. Upload Foto Bukti (Menggunakan middleware temp Anda)
router.post(
  "/upload-foto",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  upload.single("foto"), // Jika upload satu per satu. Pakai upload.array jika multiple.
  controller.uploadFoto,
);

router.get(
  "/lookup/invoice",
  verifyToken,
  checkPermission(MENU_ID, "insert"), // View/Insert bebas
  controller.lookupInvoice,
);

router.get(
  "/lookup/invoice-details/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.getInvoiceDetails,
);

module.exports = router;
