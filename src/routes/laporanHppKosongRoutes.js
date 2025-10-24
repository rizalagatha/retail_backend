const express = require('express');
const router = express.Router();
const controller = require('../controllers/laporanHppKosongController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '704';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.get('/cabang-options', verifyToken, checkPermission(MENU_ID, 'view'), controller.getCabangOptions);

module.exports = router;