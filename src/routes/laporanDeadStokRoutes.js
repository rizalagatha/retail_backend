const express = require('express');
const router = express.Router();
const controller = require('../controllers/laporanDeadStokController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '510';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);

router.get('/cabang-options', verifyToken, controller.getCabangOptions);

module.exports = router;