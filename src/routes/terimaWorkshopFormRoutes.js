const express = require("express");
const router = express.Router();
const terimaWorkshopFormController = require("../controllers/terimaWorkshopFormController");
const { verifyToken } = require("../middleware/authMiddleware");

// Endpoint untuk memuat data dari dokumen pengiriman
router.get(
  "/load-kirim",
  verifyToken,
  terimaWorkshopFormController.loadFromKirim,
);

// Endpoint untuk menyimpan penerimaan mutasi workshop
router.post("/save", verifyToken, terimaWorkshopFormController.save);

module.exports = router;
