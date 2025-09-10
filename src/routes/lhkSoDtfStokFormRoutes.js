const express = require('express');
const router = express.Router();
const lhkSoDtfStokFormController = require('../controllers/lhkSoDtfStokFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '48'; // Asumsi ID Menu untuk Form LHK SO DTF Stok

// GET: Memuat data LHK Stok yang sudah ada untuk mode "Ubah"
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), lhkSoDtfStokFormController.loadForEdit);

// GET: Mencari SO DTF Stok yang valid untuk diinput (form bantuan)
router.get('/lookup/so-stok', verifyToken, checkPermission(MENU_ID, 'view'), lhkSoDtfStokFormController.searchSoStok);

// GET: Mengambil detail item dari SO DTF Stok terpilih untuk mengisi grid
router.get('/lookup/so-stok-details/:soNomor', verifyToken, checkPermission(MENU_ID, 'view'), lhkSoDtfStokFormController.getSoDetailsForGrid);

// POST: Menyimpan data LHK Stok (bisa untuk baru atau update)
router.post('/save', verifyToken, checkPermission(MENU_ID, ['insert', 'edit']), lhkSoDtfStokFormController.save);

module.exports = router;
