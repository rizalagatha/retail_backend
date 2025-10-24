const express = require('express');
const router = express.Router();
const controller = require('../controllers/barangExternalFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');

const tempDir = path.join(__dirname, '../../public/images/temp');
const upload = multer({ dest: tempDir });

const MENU_ID = '219';

router.get('/get-new-barcode-id', verifyToken, controller.getNewBarcodeId);
router.get('/initial-data', verifyToken, controller.getInitialData);
router.get('/ukuran-options/:kategori', verifyToken, controller.getUkuranOptions);
router.get('/:kode', verifyToken, checkPermission(MENU_ID, 'edit'), controller.getDataForEdit);

router.post('/', verifyToken, checkPermission(MENU_ID, 'insert'), upload.single('file'), controller.saveData);
router.put('/:kode', verifyToken, checkPermission(MENU_ID, 'edit'), upload.single('file'), controller.saveData);

module.exports = router;