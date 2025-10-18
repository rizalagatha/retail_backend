const express = require('express');
const router = express.Router();
const controller = require('../controllers/paretoController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '511';

// Rute utama untuk mengambil data laporan
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);

// Rute untuk mengisi dropdown filter cabang
router.get('/cabang-options', verifyToken, controller.getCabangOptions);

// Rute untuk mengisi dropdown filter kategori
router.get('/kategori-options', verifyToken, controller.getKategoriOptions);

module.exports = router;