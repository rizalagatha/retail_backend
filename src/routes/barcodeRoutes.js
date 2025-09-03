const express = require('express');
const router = express.Router();
const barcodeController = require('../controllers/barcodeController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

// Definisikan ID Menu untuk Cetak Barcode
const BARCODE_MENU_ID = 11;

// GET /api/barcodes -> Membutuhkan hak 'view' untuk melihat daftar header
router.get('/', verifyToken, checkPermission(BARCODE_MENU_ID, 'view'), barcodeController.getHeaders);

// GET /api/barcodes/:nomor -> Membutuhkan hak 'view' untuk melihat detail
router.get('/:nomor', verifyToken, checkPermission(BARCODE_MENU_ID, 'view'), barcodeController.getDetails);

module.exports = router;
