const express = require("express");
const router = express.Router();
const controller = require("../controllers/mintaAccesoriesController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "225";

// Ambil Daftar Permintaan (Browse) - Hak akses: View
router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getAll,
);

// Ambil Detail Permintaan (Expand Row) - Hak akses: View
router.get(
  "/:nomor/details",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetails,
);

// Hapus Permintaan - Hak akses: Delete
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.deletePermintaan,
);

// Close Manual Permintaan - Hak akses: Edit
router.put(
  "/:nomor/close-manual",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.closeManual,
);

// GET /api/minta-accesories/check-unapproved
router.get("/check-unapproved", verifyToken, controller.checkUnapproved);

// PUT /api/minta-accesories/realisasi/:prominNomor/approve
router.put(
  "/realisasi/:prominNomor/approve",
  verifyToken,
  controller.approveRealisasi,
);

module.exports = router;
