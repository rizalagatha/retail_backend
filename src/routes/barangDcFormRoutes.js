const express = require("express");
const router = express.Router();
const controller = require("../controllers/barangDcFormController");
const {
  verifyToken,
  checkPermission,
  checkSavePermission,
} = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware"); // Middleware untuk upload file

const MENU_ID = "204";

router.get(
  "/initial-data",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getInitialData
);
router.post(
  "/save",
  verifyToken,
  checkSavePermission(MENU_ID),
  controller.save
);
router.post(
  "/upload-image/:kode",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  upload.single("image"),
  controller.uploadImage
);
router.get(
  "/lookup/warna-kain",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchWarnaKain
);

router.get(
  "/lookup/buffer",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getBuffer
);

router.get(
  "/next-bcdid",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getNextBcdId
);

router.get(
  "/:kode",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.getForEdit
);

module.exports = router;
