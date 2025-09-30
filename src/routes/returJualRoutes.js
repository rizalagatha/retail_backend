const express = require('express');
const router = express.Router();
const controller = require('../controllers/returJualController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '29';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.get('/details/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDetails);
router.get('/payment-links/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getPaymentLinks);
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), controller.remove);
router.get('/lookup/cabang', verifyToken, checkPermission(MENU_ID, 'view'), controller.getCabangOptions);

module.exports = router;