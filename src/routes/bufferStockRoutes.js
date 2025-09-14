const express = require('express');
const router = express.Router();
const bufferStockController = require('../controllers/bufferStockController');
const { verifyToken } = require('../middleware/authMiddleware');

router.post('/update', bufferStockController.update);

// GET: Mengambil daftar Buffer Stok berdasarkan filter
router.get('/', verifyToken, bufferStockController.getAll);

// GET: Mengambil daftar cabang untuk filter
router.get('/lookup/cabang', verifyToken, bufferStockController.getCabangList);

// POST: Menyimpan pengaturan Min/Max Buffer
router.post('/setting', verifyToken, bufferStockController.saveSetting);

module.exports = router;