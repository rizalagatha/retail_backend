const express = require('express');
const router = express.Router();
const controller = require('../controllers/laporanInvoiceController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '505';


router.get('/cabang/options', verifyToken, checkPermission(MENU_ID, 'view'), controller.getCabangOptions);

// Rute utama untuk mendapatkan data master laporan (Per Tanggal/Pelanggan/Level)
router.get('/master', verifyToken, checkPermission(MENU_ID, 'view'), controller.getInvoiceMasterData);

// Rute untuk mendapatkan detail pelanggan (khusus mode Per Level)
router.get('/detail-customer-by-level', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDetailByLevel);

module.exports = router;