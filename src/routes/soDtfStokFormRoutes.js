const express = require('express');
const router = express.Router();
const soDtfStokFormController = require('../controllers/soDtfStokFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '36'; // ID Menu SO DTF Stok

// GET: Memuat data lengkap untuk form mode Ubah
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), soDtfStokFormController.loadDataForEdit);

// GET: Mengambil template item untuk mengisi grid
router.get('/lookup/template-items/:jenisOrder', verifyToken, checkPermission(MENU_ID, 'view'), soDtfStokFormController.getTemplateItems);

// POST: Menyimpan data baru
router.post('/', verifyToken, checkPermission(MENU_ID, 'insert'), soDtfStokFormController.saveData);

// PUT: Memperbarui data yang ada
router.put('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), soDtfStokFormController.saveData);

// TODO: Tambahkan rute untuk form bantuan lain jika diperlukan (sales, jenis order, dll.)

module.exports = router;
