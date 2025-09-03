const express = require('express');
const router = express.Router();
const barcodeFormController = require('../controllers/barcodeFormController');

// GET /api/barcode-form/next-number -> Mendapatkan nomor transaksi baru
router.get('/next-number', barcodeFormController.getNextNumber);

// GET /api/barcode-form/search-products -> Mencari produk
router.get('/search-products', barcodeFormController.searchProducts);

// GET /api/barcode-form/product-details/:productCode -> Mendapatkan detail ukuran & barcode produk
router.get('/product-details/:productCode', barcodeFormController.getProductDetails);

// POST /api/barcode-form/save -> Menyimpan data barcode baru
router.post('/save', barcodeFormController.save);

module.exports = router;
