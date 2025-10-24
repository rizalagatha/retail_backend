const express = require('express');
const router = express.Router();
const controller = require('../controllers/laporanStokPivotController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '507';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.get('/chart-data', verifyToken, checkPermission(MENU_ID, 'view'), controller.getChartData);
router.get('/cabang-options', verifyToken, controller.getCabangOptions);

module.exports = router;