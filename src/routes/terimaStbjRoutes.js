const express = require('express');
const router = express.Router();
const controller = require('../controllers/terimaStbjController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '211';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.get('/details', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDetails);
router.delete('/cancel-receipt', verifyToken, checkPermission(MENU_ID, 'delete'), controller.cancelReceipt);
router.delete('/cancel-rejection', verifyToken, checkPermission(MENU_ID, 'delete'), controller.cancelRejection);
router.get('/export-details', verifyToken, checkPermission(MENU_ID, 'view'), controller.exportDetails);

module.exports = router;