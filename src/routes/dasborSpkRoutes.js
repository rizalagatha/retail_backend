const express = require("express");
const router = express.Router();
const dasborSpkController = require("../controllers/dasborSpkController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "226";

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  dasborSpkController.getDasborData,
);
router.get(
  "/detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  dasborSpkController.getDasborDetail,
);
router.get(
  "/cabang-list",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  dasborSpkController.getCabangList,
);
router.get(
  "/kuota",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  dasborSpkController.getKuota,
);
router.post(
  "/kuota",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  dasborSpkController.saveKuota,
);
router.get(
  "/export-header",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  dasborSpkController.exportHeader,
);
router.get(
  "/export-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  dasborSpkController.exportDetail,
);

module.exports = router;
