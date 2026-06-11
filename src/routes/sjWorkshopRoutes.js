const express = require("express");
const router = express.Router();
const controller = require("../controllers/sjWorkshopController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "803";

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getList,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getDetails,
);

module.exports = router;
