const express = require('express');
const router = express.Router();
const controller = require('../controllers/refundController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '55'; // Sesuai permintaan

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.get('/details/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDetails);
router.get('/export-details', verifyToken, checkPermission(MENU_ID, 'view'), controller.exportDetails);
router.get('/cabang-options', verifyToken, controller.getCabangOptions);
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), controller.deleteRefund);

module.exports = router;