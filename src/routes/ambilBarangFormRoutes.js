const express = require('express');
const router = express.Router();
const controller = require('../controllers/ambilBarangFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '253';

// Rute untuk lookup produk via barcode di dalam form
router.get('/lookup/product-by-barcode', verifyToken, checkPermission(MENU_ID, 'view'), controller.lookupProductByBarcode);

// Rute untuk mengambil data saat form dalam mode 'Ubah'
router.get('/:id', verifyToken, checkPermission(MENU_ID, 'edit'), controller.getById);

// Rute untuk menyimpan data baru (Create)
router.post('/', verifyToken, checkPermission(MENU_ID, 'insert'), controller.saveNew);

// Rute untuk memperbarui data yang ada (Update)
router.put('/:id', verifyToken, checkPermission(MENU_ID, 'edit'), controller.updateExisting);

// Route untuk cek status approval data yang sudah di-close
router.get('/:id/approval-status', verifyToken, controller.getApprovalStatus);

// Route untuk memvalidasi PIN khusus form ini
router.post('/validate-pin', verifyToken, controller.validatePin);

module.exports = router;