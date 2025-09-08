const express = require('express');
const router = express.Router();
const soDtfFormController = require('../controllers/soDtfFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

const MENU_ID = 35; // ID Menu untuk SO DTF Pesanan

// GET: Mengambil data untuk form edit
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), soDtfFormController.getById);

// POST: Membuat SO DTF baru
router.post('/', verifyToken, checkPermission(MENU_ID, 'insert'), soDtfFormController.create);

// PUT: Memperbarui SO DTF yang ada
router.put('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), soDtfFormController.update);

router.get('/search/sales', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.searchSales);

router.get('/search/jenis-order', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.searchJenisOrder);

router.get('/search/jenis-kain', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.searchJenisKain);

router.get('/search/workshop', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.searchWorkshop);

router.get('/sisa-kuota', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.getSisaKuota);

router.post(
    '/upload-image/:nomor',
    verifyToken,
    checkPermission(MENU_ID, 'edit'), // Atau 'insert' jika lebih sesuai
    upload.single('image'), // 'image' adalah nama field dari frontend
    soDtfFormController.uploadImage
);

router.get('/lookup/ukuran-kaos', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.getUkuranKaos);

router.get('/lookup/ukuran-sodtf-detail', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.getUkuranSodtfDetail);

router.post('/calculate-dtg-price', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.calculateDtgPrice);

router.get('/lookup/size-cetak', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.getSizeCetak);

module.exports = router;

