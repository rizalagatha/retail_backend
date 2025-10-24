const express = require('express');
const router = express.Router();
const controller = require('../controllers/mutasiAntarGudangFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '216';

router.get('/gudang-options', verifyToken, controller.getGudangOptions);
router.get('/product-by-barcode', verifyToken, controller.getProductByBarcode);
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.getDataForEdit);
router.post('/', verifyToken, checkPermission(MENU_ID, 'insert'), controller.saveData);
router.put('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.saveData);
router.get('/print/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getPrintData);

module.exports = router;