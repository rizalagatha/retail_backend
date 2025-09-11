const express = require('express');
const router = express.Router();
const soDtfFormController = require('../controllers/soDtfFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

const MENU_ID = 35; // ID Menu untuk SO DTF Pesanan

// PENTING: Routes dengan path spesifik HARUS di atas routes dengan parameter dinamis

// Routes untuk pencarian dan lookup
router.get('/search/sales', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.searchSales);
router.get('/search/jenis-order', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.searchJenisOrder);
router.get('/search/jenis-kain', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.searchJenisKain);
router.get('/search/workshop', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.searchWorkshop);

// Routes untuk lookup
router.get('/lookup/ukuran-kaos', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.getUkuranKaos);
router.get('/lookup/ukuran-sodtf-detail', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.getUkuranSodtfDetail);
router.get('/lookup/size-cetak', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.getSizeCetak);

// Routes untuk utilitas
router.get('/sisa-kuota', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.getSisaKuota);
router.post('/calculate-dtg-price', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.calculateDtgPrice);

// Routes untuk upload dan print (dengan parameter)
router.post('/upload-image/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), upload.single('image'), soDtfFormController.uploadImage);
router.get('/print-data/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.getPrintData);

// POST dan PUT untuk CRUD utama
router.post('/', verifyToken, checkPermission(MENU_ID, 'insert'), soDtfFormController.create);
router.put('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), soDtfFormController.update);

// GET by nomor (HARUS paling terakhir karena menggunakan parameter dinamis)
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), soDtfFormController.getById);

module.exports = router;