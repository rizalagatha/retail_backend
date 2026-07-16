const express = require("express");
const router = express.Router();
const laporanProduktivitasController = require("../controllers/laporanProduktivitasController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const LAPORAN_PRODUKTIVITAS_MENU_ID = 707;

router.get(
  "/open-pipeline",
  verifyToken,
  checkPermission(LAPORAN_PRODUKTIVITAS_MENU_ID, "view"),
  laporanProduktivitasController.getOpenPipeline,
);
router.get(
  "/user-options",
  verifyToken,
  checkPermission(LAPORAN_PRODUKTIVITAS_MENU_ID, "view"),
  laporanProduktivitasController.getUserOptions,
);

router.get(
  "/branch-options",
  verifyToken,
  checkPermission(LAPORAN_PRODUKTIVITAS_MENU_ID, "view"),
  laporanProduktivitasController.getBranchOptions,
);

router.get(
  "/open-penawaran-detail",
  verifyToken,
  checkPermission(LAPORAN_PRODUKTIVITAS_MENU_ID, "view"),
  laporanProduktivitasController.getOpenPenawaranDetail,
);

router.get(
  "/open-so-detail",
  verifyToken,
  checkPermission(LAPORAN_PRODUKTIVITAS_MENU_ID, "view"),
  laporanProduktivitasController.getOpenSoDetail,
);

router.get(
  "/closed-pipeline",
  verifyToken,
  checkPermission(LAPORAN_PRODUKTIVITAS_MENU_ID, "view"),
  laporanProduktivitasController.getClosedPipeline,
);
router.get(
  "/closed-penawaran-won-detail",
  verifyToken,
  checkPermission(LAPORAN_PRODUKTIVITAS_MENU_ID, "view"),
  laporanProduktivitasController.getClosedPenawaranWonDetail,
);
router.get(
  "/closed-penawaran-lost-detail",
  verifyToken,
  checkPermission(LAPORAN_PRODUKTIVITAS_MENU_ID, "view"),
  laporanProduktivitasController.getClosedPenawaranLostDetail,
);
router.get(
  "/closed-so-won-detail",
  verifyToken,
  checkPermission(LAPORAN_PRODUKTIVITAS_MENU_ID, "view"),
  laporanProduktivitasController.getClosedSoWonDetail,
);
router.get(
  "/closed-so-lost-detail",
  verifyToken,
  checkPermission(LAPORAN_PRODUKTIVITAS_MENU_ID, "view"),
  laporanProduktivitasController.getClosedSoLostDetail,
);
// route
router.get(
  "/open-pipeline-tree",
  verifyToken,
  checkPermission(LAPORAN_PRODUKTIVITAS_MENU_ID, "view"),
  laporanProduktivitasController.getOpenPipelineTree,
);
router.get(
  "/tree/penawaran-detail",
  verifyToken,
  checkPermission(LAPORAN_PRODUKTIVITAS_MENU_ID, "view"),
  laporanProduktivitasController.getPenawaranBucketDetail,
);
router.get(
  "/tree/so-internal-detail",
  verifyToken,
  checkPermission(LAPORAN_PRODUKTIVITAS_MENU_ID, "view"),
  laporanProduktivitasController.getSoInternalBucketDetailHandler,
);
router.get(
  "/tree/so-pabrik-detail",
  verifyToken,
  checkPermission(LAPORAN_PRODUKTIVITAS_MENU_ID, "view"),
  laporanProduktivitasController.getSoPabrikBucketDetailHandler,
);
router.get(
  "/tree/so-internal-detail-all",
  verifyToken,
  checkPermission(LAPORAN_PRODUKTIVITAS_MENU_ID, "view"),
  laporanProduktivitasController.getSoInternalAllDetailHandler,
);
router.get(
  "/tree/so-pabrik-detail-all",
  verifyToken,
  checkPermission(LAPORAN_PRODUKTIVITAS_MENU_ID, "view"),
  laporanProduktivitasController.getSoPabrikAllDetailHandler,
);

module.exports = router;
