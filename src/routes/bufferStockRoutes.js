const express = require('express');
const router = express.Router();
const bufferStockController = require('../controllers/bufferStockController');

router.post('/update', bufferStockController.update);

// GET: Mengambil daftar Buffer Stok berdasarkan filter
router.get('/', bufferStockController.getAll);

// GET: Mengambil daftar cabang untuk filter
router.get('/lookup/cabang', bufferStockController.getCabangList);

// POST: Menyimpan pengaturan Min/Max Buffer
router.post('/setting', bufferStockController.saveSetting);

module.exports = router;