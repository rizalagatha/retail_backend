const express = require('express');
const router = express.Router();
const controller = require('../controllers/ambilBarangController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '253';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.get('/details', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDetails);
router.get('/lookup/products', verifyToken, checkPermission(MENU_ID, 'view'), controller.lookupProducts);
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), controller.deleteAmbilBarang);

module.exports = router;