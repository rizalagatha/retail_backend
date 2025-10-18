const express = require('express');
const router = express.Router();
const controller = require('../controllers/hitungStokFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '23';

// Rute untuk mengambil detail produk berdasarkan barcode yang di-scan
router.get('/product-by-barcode/:barcode', verifyToken, checkPermission(MENU_ID, 'view'), controller.getProductByBarcode);

// Rute untuk memproses hasil scan (INSERT/UPDATE ke database)
router.post('/process-scan', verifyToken, checkPermission(MENU_ID, 'insert'), controller.processScan);

// Rute untuk mengambil daftar item yang sudah di-scan di lokasi tertentu
router.get('/scanned-items', verifyToken, checkPermission(MENU_ID, 'view'), controller.getScannedItemsByLocation);

module.exports = router;