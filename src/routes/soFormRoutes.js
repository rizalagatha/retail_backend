const express = require('express');
const router = express.Router();
const soFormController = require('../controllers/soFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '26'; // ID Menu Surat Pesanan

// GET: Memuat semua data yang dibutuhkan untuk form mode "Ubah"
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), soFormController.getForEdit);

// POST: Menyimpan data SO (bisa untuk baru atau update)
router.post('/save', verifyToken, checkPermission(MENU_ID, ['insert', 'edit']), soFormController.save);

// --- Rute untuk Form Bantuan (Lookups) ---
router.get('/lookup/penawaran', verifyToken, checkPermission(MENU_ID, 'view'), soFormController.searchPenawaran);
router.get('/lookup/penawaran-details/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), soFormController.getPenawaranDetails);
// ... tambahkan rute lookup lain jika perlu

module.exports = router;
