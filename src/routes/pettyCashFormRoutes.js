const express = require("express");
const router = express.Router();
const pettyCashFormController = require("../controllers/pettyCashFormController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

// Import middleware upload Anda (sesuaikan path-nya jika berbeda)
const upload = require("../middleware/uploadMiddleware");

// Gunakan upload.any() karena field name dinamis (file_0, file_1, dst)
router.post(
  "/save",
  verifyToken,
  upload.any(),
  pettyCashFormController.saveData,
);

// --- TARUH SALDO DI ATAS :NOMOR ---
router.get("/saldo", verifyToken, pettyCashFormController.getSaldoStore);
router.get(
  "/klaim-detail/:pck_nomor",
  verifyToken,
  pettyCashFormController.getDetailKlaimFinance,
);
router.get("/:nomor", verifyToken, pettyCashFormController.getDetail);
router.put("/approve/:nomor", verifyToken, pettyCashFormController.approve);
router.put("/reject/:nomor", verifyToken, pettyCashFormController.reject);
router.get("/print/:nomor", verifyToken, pettyCashFormController.getPrintData);

module.exports = router;
