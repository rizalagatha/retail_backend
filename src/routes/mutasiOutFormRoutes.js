const express = require('express');
const router = express.Router();
const mutasiOutFormController = require('../controllers/mutasiOutFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '43'; // ID Menu Mutasi Out

// GET: Memuat data Mutasi Out yang ada untuk mode "Ubah"
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), mutasiOutFormController.loadForEdit);

// GET: Mencari SO yang valid untuk diinput (form bantuan)
router.get('/lookup/so', verifyToken, checkPermission(MENU_ID, 'view'), mutasiOutFormController.searchSo);

// GET: Mengambil detail item dari SO terpilih untuk mengisi grid
router.get('/lookup/so-details/:soNomor', verifyToken, checkPermission(MENU_ID, 'view'), mutasiOutFormController.getSoDetailsForGrid);

// POST: Menyimpan data Mutasi Out
router.post('/save', verifyToken, checkPermission(MENU_ID, ['insert', 'edit']), mutasiOutFormController.save);

module.exports = router;