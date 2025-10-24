const express = require('express');
const router = express.Router();
const controller = require('../controllers/laporanSaldoKasirController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '601';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.get('/gudang-options', verifyToken, controller.getGudangOptions);

module.exports = router;