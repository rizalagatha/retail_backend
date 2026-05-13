const express = require("express");
const router = express.Router();
const katalogController = require("../controllers/katalogController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

const MENU_ID = "26";

router.get("/list", verifyToken, katalogController.getKatalogList);

router.get(
  "/gallery/:kodeBarang",
  verifyToken,
  katalogController.getGalleryByKode,
);

// POST: Upload gambar produk
router.post(
  "/upload/:kodeBarang",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  upload.single("image"),
  katalogController.uploadGambarProduk,
);

// PUT: Update urutan massal
router.put(
  "/update-urutan",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  katalogController.updateUrutanMassal,
);

router.delete(
  "/gallery/:kodeBarang/:index",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  katalogController.deleteGambarProduk,
);

router.put(
  "/gallery/swap/:kodeBarang/:indexA/:indexB",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  katalogController.swapGambarProduk,
);

module.exports = router;
