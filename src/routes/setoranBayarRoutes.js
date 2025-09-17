const express = require('express');
const router = express.Router();
const controller = require('../controllers/setoranBayarController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '51'; // Menu ID untuk Setoran Pembayaran

// Endpoint utama untuk mendapatkan daftar data (master)
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);

// Endpoint untuk mendapatkan data detail berdasarkan nomor
router.get('/details/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDetails);

// Endpoint untuk mendapatkan daftar cabang (untuk filter)
router.get('/lookup/cabang', verifyToken, checkPermission(MENU_ID, 'view'), controller.getCabangList);

// Endpoint untuk menghapus data setoran
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), controller.remove);

// Endpoint untuk mengekspor data detail ke Excel
router.get('/export-details', verifyToken, checkPermission(MENU_ID, 'view'), controller.exportDetails);


module.exports = router;

