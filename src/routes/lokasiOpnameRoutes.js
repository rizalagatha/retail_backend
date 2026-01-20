const express = require("express");
const router = express.Router();
const controller = require("../controllers/lokasiOpnameController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "18";

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getList,
);
router.get(
  "/master",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getMasterOptions,
);
router.post(
  "/generate",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.bulkGenerate,
);
router.delete(
  "/:id",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.remove,
);

module.exports = router;
