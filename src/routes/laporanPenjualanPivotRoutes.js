const express = require('express');
const router = express.Router();
const controller = require('../controllers/laporanPenjualanPivotController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '506';

// This single route handles fetching all raw data for the report
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getSalesData);

router.get('/chart-data', verifyToken, checkPermission(MENU_ID, 'view'), controller.getChartData);

module.exports = router;