const express = require('express');
const router = express.Router();
const controller = require('../controllers/mutasiKirimFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '46'; // Sesuaikan dengan ID Menu Mutasi Kirim Anda

// GET: Mengambil data untuk form mode ubah
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.getForEdit);

// POST: Menyimpan data baru atau yang sudah diubah
router.post('/save', verifyToken, controller.save);

// GET: Lookup untuk Store Tujuan
router.get('/lookup/tujuan-store', verifyToken, checkPermission(MENU_ID, 'view'), controller.lookupTujuanStore);

// GET: Lookup untuk detail produk tunggal
router.get('/lookup/product-details', verifyToken, checkPermission(MENU_ID, 'view'), controller.getProductDetails);

router.get('/lookup/by-barcode/:barcode', verifyToken, checkPermission(MENU_ID, 'view'), controller.findByBarcode);

router.get('/print/:nomor', verifyToken, controller.getPrintData);

module.exports = router;