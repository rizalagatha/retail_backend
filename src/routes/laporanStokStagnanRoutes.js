const express = require('express');
const router = express.Router();
const controller = require('../controllers/laporanStokStagnanController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '508';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.get('/export-details', verifyToken, checkPermission(MENU_ID, 'view'), controller.getExportDetails);

module.exports = router;