const express = require('express');
const router = express.Router();
const controller = require('../controllers/terimaRepairController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '212';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.get('/details/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDetails);
router.delete('/cancel-receipt/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), controller.cancelReceipt);
router.get('/export-details', verifyToken, checkPermission(MENU_ID, 'view'), controller.exportDetails);

module.exports = router;