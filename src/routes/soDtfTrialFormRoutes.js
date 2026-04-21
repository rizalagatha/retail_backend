const express = require("express");
const router = express.Router();
const controller = require("../controllers/soDtfTrialFormController");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "61";

// Multer Config untuk upload sementara
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = path.join(process.cwd(), "../temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    cb(
      null,
      `sodtf-trial-temp-${Date.now()}${path.extname(file.originalname)}`,
    );
  },
});
const upload = multer({ storage });

// Rute Lookup / Master Data (PENTING: Taruh sebelum route /:nomor)
router.get(
  "/lookup/sales",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchSales,
);
router.get(
  "/lookup/jenis-order",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchJenisOrder,
);
router.get(
  "/lookup/jenis-kain",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchJenisKain,
);
router.get(
  "/lookup/workshop",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchWorkshop,
);
router.get(
  "/lookup/ukuran-kaos",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getUkuranKaos,
);
router.get(
  "/lookup/size-cetak",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getSizeCetak,
);
router.get(
  "/lookup/ukuran-sodtf-detail",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getUkuranDetail,
);
router.get(
  "/lookup/so-list",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchSoList,
);
router.get(
  "/so-detail/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getSoDetail,
);

// Kalkulasi Harga
router.post(
  "/calculate-dtg-price",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.calculateDtgPrice,
);

// Upload Image (Tarik minimal akses 'edit' atau 'insert')
router.post(
  "/upload-image/:nomor/:revisiKe",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  upload.single("image"),
  controller.uploadImage,
);

// Rute CRUD Utama
router.post(
  "/",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.create,
);
router.put(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.update,
);

// Route getById (dinamis) WAJIB ditaruh dipaling bawah agar tidak meng-intercept route /lookup/...
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getById,
);

module.exports = router;
