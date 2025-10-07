const express = require('express');
const router = express.Router();
const controller = require('../controllers/pengajuanBarcodeController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '33';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.get('/details/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDetails);
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), controller.remove);
router.get('/lookup/cabang', verifyToken, checkPermission(MENU_ID, 'view'), controller.getCabangOptions);
router.get('/export-details', verifyToken, checkPermission(MENU_ID, 'view'), controller.exportDetails);

module.exports = router;