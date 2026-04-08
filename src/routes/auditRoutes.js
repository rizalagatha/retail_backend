// routes/auditRoute.js
const express = require("express");
const router = express.Router();
const controller = require("../controllers/auditLogController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "602"; // ID Menu untuk Audit Trail

// --- 1. RUTE STATIS (HARUS DI ATAS) ---
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getLogs,
);

router.get(
  "/modules",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getModules,
);

router.get(
  "/actions",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getActions,
);

router.get(
  "/cabang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getCabangList,
);

// --- 2. RUTE DINAMIS PARAMETER (HARUS PALING BAWAH) ---
router.get(
  "/:id",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getLogById,
);

module.exports = router;
