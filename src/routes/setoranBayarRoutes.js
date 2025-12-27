const express = require("express");
const router = express.Router();
const controller = require("../controllers/setoranBayarController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "51";

// [PENTING] Letakkan route export di bagian ATAS
router.get(
  "/export-details",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.exportDetails
);

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getList
);
router.get(
  "/lookup/cabang",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getCabangList
);
router.get(
  "/details/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetails
);
router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.remove
);

module.exports = router;
