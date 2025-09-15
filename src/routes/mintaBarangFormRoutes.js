const express = require('express');
const router = express.Router();
const mintaBarangFormController = require('../controllers/mintaBarangFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '37'; // ID Menu untuk Minta Barang

// POST: Menyimpan data Minta Barang (baru atau ubah)
router.post('/save', verifyToken, checkPermission(MENU_ID, ['insert', 'edit']), mintaBarangFormController.save);

// GET: Memuat data Minta Barang yang sudah ada untuk mode "Ubah"
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), mintaBarangFormController.loadForEdit);

// GET: Mengambil data dari Buffer Stok untuk di-load ke grid
router.get('/lookup/buffer-stok', verifyToken, checkPermission(MENU_ID, 'view'), mintaBarangFormController.getBufferStokItems);
router.get('/lookup/so-details/:soNomor', verifyToken, checkPermission(MENU_ID, 'view'), mintaBarangFormController.getSoDetailsForGrid);
router.get('/lookup/product-details', verifyToken, checkPermission(MENU_ID, 'view'), mintaBarangFormController.getProductDetails);

module.exports = router;