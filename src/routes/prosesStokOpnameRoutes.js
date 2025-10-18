const express = require('express');
const router = express.Router();
const controller = require('../controllers/prosesStokOpnameController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '24';

// Rute utama untuk mengambil daftar
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);

// Rute untuk mengambil opsi cabang (jika diperlukan di filter)
router.get('/cabang-options', verifyToken, controller.getCabangOptions);

// Rute untuk menjalankan proses Transfer SOP
router.post('/validate-pin', verifyToken, controller.validatePin);

router.post('/transfer/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.transferSop);

router.get('/details/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDetails);

router.get('/export-details', verifyToken, checkPermission(MENU_ID, 'view'), controller.exportDetails);

module.exports = router;