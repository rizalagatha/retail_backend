// routes/auditRoute.js
const express = require("express");
const router = express.Router();
const controller = require("../controllers/auditLogController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "602"; // ID Menu untuk Audit Trail

// Tambahkan checkPermission dengan hak akses 'view'
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getLogs
);
router.get(
  "/modules",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getModules
);

router.get(
  "/actions",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getActions
);

router.get(
  "/cabang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getCabangList
);

module.exports = router;
