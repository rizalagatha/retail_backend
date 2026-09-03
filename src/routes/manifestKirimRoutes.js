const express = require("express");
const router = express.Router();
const manifestKirimController = require("../controllers/manifestKirimController");
const {
  verifyToken,
  checkPermission,
  checkSavePermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "227"; // ID Menu untuk Manifest Pengiriman DC

router.get("/", verifyToken, checkPermission(MENU_ID, "view"), manifestKirimController.getList);
router.get("/export-details", verifyToken, checkPermission(MENU_ID, "view"), manifestKirimController.exportDetails);
router.get("/available-sj", verifyToken, checkPermission(MENU_ID, "view"), manifestKirimController.getAvailableSj);
router.get("/:nomor", verifyToken, checkPermission(MENU_ID, "view"), manifestKirimController.getDetails);
router.post("/", verifyToken, checkSavePermission(MENU_ID), manifestKirimController.saveData);
router.patch("/:nomor/status", verifyToken, checkPermission(MENU_ID, "edit"), manifestKirimController.updateStatus);
router.put("/:nomor/status", verifyToken, checkPermission(MENU_ID, "edit"), manifestKirimController.updateStatus);
router.delete("/:nomor", verifyToken, checkPermission(MENU_ID, "delete"), manifestKirimController.remove);

module.exports = router;
