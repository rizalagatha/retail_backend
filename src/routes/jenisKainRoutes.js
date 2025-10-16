const express = require("express");
const router = express.Router();
const controller = require("../controllers/jenisKainController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "201";

router.get(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getAll
);
router.delete(
  "/:jenisKain",
  verifyToken,
  checkPermission(MENU_ID, "delete"),
  controller.remove
);

router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.save
);

module.exports = router;
