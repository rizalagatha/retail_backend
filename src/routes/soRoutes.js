const express = require('express');
const router = express.Router();
const soController = require('../controllers/soController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '26'; // Sesuai permintaan Anda

// GET: Mengambil daftar Surat Pesanan berdasarkan filter
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), soController.getAll);

// GET: Mengambil detail untuk satu SO
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), soController.getDetails);

// GET: Mengambil daftar cabang untuk filter
router.get('/lookup/cabang', verifyToken, checkPermission(MENU_ID, 'view'), soController.getCabangList);

// POST: Menutup Surat Pesanan
router.post('/close', verifyToken, checkPermission(MENU_ID, 'edit'), soController.close);

// DELETE: Menghapus Surat Pesanan
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), soController.remove);

module.exports = router;
