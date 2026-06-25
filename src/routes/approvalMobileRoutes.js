const express = require("express");
const router = express.Router();
const controller = require("../controllers/approvalMobileController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

// MENU ID khusus Approval Mobile
const MENU_ID = "900";

// Lihat data (Hak akses 'view')
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getList,
);

// Proses eksekusi (Hak akses 'edit' / 'approve')
// Menggunakan method PUT karena sifatnya melakukan pembaruan (UPDATE) status
router.put(
  "/approve/:deviceId",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.approveDevice,
);
router.put(
  "/reject/:deviceId",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.rejectDevice,
);

module.exports = router;
