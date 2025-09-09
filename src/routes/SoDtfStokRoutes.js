const express = require('express');
const router = express.Router();
const soDtfStokController = require('../controllers/soDtfStokController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '36'; // Asumsi ID Menu untuk SO DTF Stok

// GET: Mengambil daftar SO DTF Stok berdasarkan filter
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), soDtfStokController.getAll);

// GET: Mengambil detail untuk satu SO
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), soDtfStokController.getDetails);

// GET: Mengambil daftar cabang untuk filter
router.get('/lookup/cabang', verifyToken, checkPermission(MENU_ID, 'view'), soDtfStokController.getCabangList);

// POST: Menutup SO DTF Stok
router.post('/close', verifyToken, checkPermission(MENU_ID, 'edit'), soDtfStokController.close);

// DELETE: Menghapus SO DTF Stok
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), soDtfStokController.remove);

// Rute untuk ekspor data header
router.get('/export-header', verifyToken, checkPermission(MENU_ID, 'view'), soDtfStokController.exportHeader);

// Rute untuk ekspor data detail
router.get('/export-detail', verifyToken, checkPermission(MENU_ID, 'view'), soDtfStokController.exportDetail);

module.exports = router;
