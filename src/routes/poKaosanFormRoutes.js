const express = require('express');
const router = express.Router();
const controller = require('../controllers/poKaosanFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');

const tempDir = path.join(__dirname, '../../public/images/temp');
const upload = multer({ dest: tempDir });

const MENU_ID = '220';

// Rute baru
router.get('/referensi-pengajuan', verifyToken, checkPermission(MENU_ID, 'view'), controller.getReferensiPengajuan);
router.get('/supplier-details/:kode', verifyToken, controller.getSupplierDetails);

router.get('/print/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getPrintData);

// Rute yang sudah ada
router.get('/from-pengajuan/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDataFromPengajuan);
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.getDataForEdit);
router.post('/', verifyToken, checkPermission(MENU_ID, 'insert'), upload.any(), controller.saveData);
router.put('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), upload.any(), controller.saveData);
router.get('/product-by-barcode', verifyToken, controller.getProductByBarcode);

module.exports = router;