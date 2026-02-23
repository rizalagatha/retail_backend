const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");
const { verifyToken } = require("../middleware/authMiddleware");
const { verify } = require("jsonwebtoken");

// Rute untuk mengambil statistik kartu (penjualan & transaksi hari ini)
router.get("/today-stats", verifyToken, dashboardController.getTodayStats);

// Rute untuk mengambil data grafik penjualan
router.get("/sales-chart", verifyToken, dashboardController.getSalesChartData);

router.get(
  "/cabang-options",
  verifyToken,
  dashboardController.getCabangOptions,
);

router.get(
  "/recent-transactions",
  verifyToken,
  dashboardController.getRecentTransactions,
);

router.get(
  "/pending-actions",
  verifyToken,
  dashboardController.getPendingActions,
);

router.get(
  "/top-products",
  verifyToken,
  dashboardController.getTopSellingProducts,
);

router.get(
  "/sales-target-summary",
  verifyToken,
  dashboardController.getSalesTargetSummary,
);

router.get(
  "/branch-performance",
  verifyToken,
  dashboardController.getBranchPerformance,
);

// Rute baru untuk ringkasan stok stagnan
router.get(
  "/stagnant-stock-summary",
  verifyToken,
  dashboardController.getStagnantStockSummary,
);

router.get(
  "/total-sisa-piutang",
  verifyToken,
  dashboardController.getTotalSisaPiutang,
);

router.get(
  "/piutang-per-cabang",
  verifyToken,
  dashboardController.getPiutangPerCabang,
);

router.get(
  "/piutang-per-invoice",
  verifyToken,
  dashboardController.getPiutangPerInvoice,
);

router.get("/total-stok", verifyToken, dashboardController.getTotalStok);

router.get(
  "/total-stok-per-cabang",
  verifyToken,
  dashboardController.getTotalStokPerCabang,
);

router.get(
  "/item-sales-trend",
  verifyToken,
  dashboardController.getItemSalesTrend,
);

router.get("/changelog", verifyToken, dashboardController.getAppChangelog);

router.get("/stock-alerts", verifyToken, dashboardController.getStockAlerts);

router.get("/stok-kosong", verifyToken, dashboardController.getStokKosong);

router.get(
  "/pareto-health",
  verifyToken,
  dashboardController.getParetoStockHealth,
);

router.get(
  "/pareto-details",
  verifyToken,
  dashboardController.getParetoDetails,
);

router.get(
  "/shipment-schedules",
  verifyToken,
  dashboardController.getShipmentSchedules,
);
router.post(
  "/shipment-schedules",
  verifyToken,
  dashboardController.createShipmentSchedule,
);
router.patch(
  "/shipment-schedules/status",
  verifyToken,
  dashboardController.updateStatus,
);

router.get(
  "/master-jadwal-rutin",
  verifyToken,
  dashboardController.getMasterJadwal,
);

router.get(
  "/cashflow-summary",
  verifyToken,
  dashboardController.getCashflowSummary,
);

router.get(
  "/branch-info/:cabang",
  verifyToken,
  dashboardController.getBranchInfo,
);

module.exports = router;
