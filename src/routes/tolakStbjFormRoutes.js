const express = require('express');
const router = express.Router();
const controller = require('../controllers/tolakStbjFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '211'; // Menggunakan MENU_ID yang sama

// Endpoint untuk memuat data awal
router.get('/load-from-stbj', verifyToken, checkPermission(MENU_ID, 'insert'), controller.loadFromStbj);

// Endpoint untuk menyimpan data form penolakan
router.post('/save', verifyToken, checkPermission(MENU_ID, 'insert'), controller.save);


module.exports = router;