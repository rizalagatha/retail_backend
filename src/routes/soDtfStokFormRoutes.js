const express = require('express');
const router = express.Router();
const soDtfStokFormController = require('../controllers/soDtfStokFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

const MENU_ID = '36'; // ID Menu SO DTF Stok

// GET: Memuat data lengkap untuk form mode Ubah
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), soDtfStokFormController.loadDataForEdit);

// GET: Mengambil template item untuk mengisi grid
router.get('/lookup/template-items/:jenisOrder', verifyToken, checkPermission(MENU_ID, 'view'), soDtfStokFormController.getTemplateItems);

// POST: Menyimpan data baru
router.post('/', verifyToken, checkPermission(MENU_ID, 'insert'), soDtfStokFormController.saveData);

// PUT: Memperbarui data yang ada
router.put('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), soDtfStokFormController.saveData);

router.get('/lookup/jenis-order-stok', verifyToken, checkPermission(MENU_ID, 'view'), soDtfStokFormController.searchJenisOrderStok);

router.post(
    '/upload-image/:nomor', 
    verifyToken, 
    checkPermission(MENU_ID, 'edit'),
    upload.single('image'), // 'image' adalah nama field dari frontend
    soDtfStokFormController.uploadImage
);

router.get('/print-data/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), soDtfStokFormController.getPrintData);

module.exports = router;
