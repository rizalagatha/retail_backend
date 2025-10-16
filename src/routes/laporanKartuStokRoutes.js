const express = require('express');
const router = express.Router();
const controller = require('../controllers/laporanKartuStokController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '502';

// Endpoint untuk mengambil daftar produk (master)
router.get('/product-list', verifyToken, checkPermission(MENU_ID, 'view'), controller.getProductList);

// Endpoint untuk mengambil detail mutasi per ukuran
router.get('/mutation-details', verifyToken, checkPermission(MENU_ID, 'view'), controller.getMutationDetails);

router.get('/kartu-stok-details', verifyToken, checkPermission(MENU_ID, 'view'), controller.getKartuDetails);

// Endpoint untuk mengisi dropdown filter gudang
router.get('/lookup/gudang-options', verifyToken, checkPermission(MENU_ID, 'view'), controller.getGudangOptions);

module.exports = router;