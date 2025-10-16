const express = require('express');
const router = express.Router();
const controller = require('../controllers/promoFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '205';

// Endpoint untuk mengambil data awal (daftar cabang & level)
router.get('/initial-data', verifyToken, checkPermission(MENU_ID, 'edit'), controller.getInitialData);

// Endpoint untuk mengambil data promo yang sudah ada (mode ubah)
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.getForEdit);

// Endpoint untuk menyimpan data promo
router.post('/save', verifyToken, checkPermission(MENU_ID, 'view'), controller.save);

// Endpoint untuk lookup produk khusus form Promo
router.get('/lookup/products', verifyToken, checkPermission(MENU_ID, 'view'), controller.lookupProducts);

module.exports = router;