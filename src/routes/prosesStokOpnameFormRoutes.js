const express = require('express');
const router = express.Router();
const controller = require('../controllers/prosesStokOpnameFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '24';

// Rute untuk mengambil data awal (selisih stok) saat form 'Baru' dibuka
router.get('/initial-data', verifyToken, checkPermission(MENU_ID, 'view'), controller.getInitialData);

// Rute untuk menyimpan data Stok Opname (Create)
router.post('/', verifyToken, checkPermission(MENU_ID, 'insert'), controller.saveData);

// Rute untuk mengambil data saat form dalam mode 'Ubah'
router.get('/:id', verifyToken, checkPermission(MENU_ID, 'edit'), controller.getDataForEdit);

router.put('/:id', verifyToken, checkPermission(MENU_ID, 'edit'), controller.updateData);

router.get('/product-details/:barcode', verifyToken, controller.getProductDetails);

router.get('/from-database', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDataFromStaging);

module.exports = router;