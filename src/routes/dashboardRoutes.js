const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { verifyToken } = require('../middleware/authMiddleware');

// Rute untuk mengambil statistik kartu (penjualan & transaksi hari ini)
router.get('/today-stats', verifyToken, dashboardController.getTodayStats);

// Rute untuk mengambil data grafik penjualan
router.get('/sales-chart', verifyToken, dashboardController.getSalesChartData);

router.get('/cabang-options', verifyToken, dashboardController.getCabangOptions);

router.get('/recent-transactions', verifyToken, dashboardController.getRecentTransactions);

router.get('/pending-actions', verifyToken, dashboardController.getPendingActions);

router.get('/top-products', verifyToken, dashboardController.getTopSellingProducts);

module.exports = router;