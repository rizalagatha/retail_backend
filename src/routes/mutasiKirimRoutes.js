const express = require('express');
const router = express.Router();
const controller = require('../controllers/mutasiKirimController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '46'; 

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.get('/details/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDetails);
router.get('/lookup/cabang', verifyToken, checkPermission(MENU_ID, 'view'), controller.getCabangList);
router.get('/lookup/products', verifyToken, checkPermission(MENU_ID, 'view'), controller.searchProducts);
router.get('/export-details', verifyToken, checkPermission(MENU_ID, 'view'), controller.exportDetails);
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), controller.remove);

module.exports = router;
