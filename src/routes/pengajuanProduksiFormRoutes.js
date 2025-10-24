const express = require('express');
const router = express.Router();
const controller = require('../controllers/pengajuanProduksiFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');
const multer = require('multer');

// Konfigurasi Multer untuk menangani upload file
const upload = multer({ dest: 'public/images/temp' }); // Simpan sementara di temp

const MENU_ID = '217';

// Rute untuk form
router.get('/supplier-details/:kode', verifyToken, controller.getSupplierDetails);
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.getDataForEdit);

// Rute save/update harus menggunakan middleware 'upload.any()' untuk menangani FormData
router.post('/', verifyToken, checkPermission(MENU_ID, 'insert'), upload.any(), controller.saveData);
router.put('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), upload.any(), controller.saveData);
router.get('/validate-ukuran/:ukuran', verifyToken, controller.validateUkuran);
router.get('/print/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getPrintData);

module.exports = router;