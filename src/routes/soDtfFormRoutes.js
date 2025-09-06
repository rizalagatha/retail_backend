const express = require('express');
const router = express.Router();
const soDtfFormController = require('../controllers/soDtfFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = 35; // ID Menu untuk SO DTF Pesanan

// GET: Mengambil data untuk form edit
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), soDtfFormController.getById);

// POST: Membuat SO DTF baru
router.post('/', verifyToken, checkPermission(MENU_ID, 'insert'), soDtfFormController.create);

// PUT: Memperbarui SO DTF yang ada
router.put('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), soDtfFormController.update);

router.get('/search/sales', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.searchSales);

router.get('/search/jenis-order', verifyToken, checkPermission(MENU_ID, 'view'), soDtfFormController.searchJenisOrder);

module.exports = router;

