const express = require('express');
const router = express.Router();
const laporanStokController = require('../controllers/laporanStokController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = 501; // Pastikan ID ini sesuai dengan di database Anda

router.get('/real-time', verifyToken, checkPermission(MENU_ID, 'view'), laporanStokController.getRealTimeStock);
router.get('/lookup/gudang-options', verifyToken, checkPermission(MENU_ID, 'view'), laporanStokController.getGudangOptions);
router.get('/low-stock', verifyToken, laporanStokController.getLowStock);

module.exports = router;