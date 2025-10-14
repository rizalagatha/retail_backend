const express = require('express');
const router = express.Router();
const controller = require('../controllers/terimaStbjFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '211';

// Endpoint untuk memuat data awal dari STBJ pengiriman
router.get('/load-from-stbj', verifyToken, checkPermission(MENU_ID, 'insert'), controller.loadFromStbj);

// Endpoint untuk menyimpan data form
router.post('/save', verifyToken, checkPermission(MENU_ID, 'insert'), controller.save);

// (Tambahkan endpoint untuk mode 'edit' jika diperlukan nanti)
// router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.getForEdit);

module.exports = router;