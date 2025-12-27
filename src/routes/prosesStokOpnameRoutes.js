const express = require('express');
const router = express.Router();
const controller = require('../controllers/prosesStokOpnameController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '24';

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
router.get("/cabang-options", verifyToken, controller.getCabangOptions);
router.post("/validate-pin", verifyToken, controller.validatePin);
router.post(
  "/transfer/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.transferSop
);
router.get(
  "/details/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetails
);

module.exports = router;