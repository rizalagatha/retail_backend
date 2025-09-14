const express = require('express');
const router = express.Router();
const bufferStockController = require('../controllers/bufferStockController');

router.post('/update', bufferStockController.update);

// GET: Mengambil daftar Buffer Stok berdasarkan filter
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), bufferStockController.getAll);

// GET: Mengambil daftar cabang untuk filter
router.get('/lookup/cabang', verifyToken, checkPermission(MENU_ID, 'view'), bufferStockController.getCabangList);

// POST: Menyimpan pengaturan Min/Max Buffer
router.post('/setting', verifyToken, checkPermission(MENU_ID, 'edit'), bufferStockController.saveSetting);

module.exports = router;