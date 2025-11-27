const express = require('express');
const router = express.Router();
const soDtfStokController = require('../controllers/soDtfStokController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '36';

// ============= EKSPOR (HARUS DI ATAS) =============
router.get('/export-header', verifyToken, checkPermission(MENU_ID, 'view'), soDtfStokController.exportHeader);
router.get('/export-detail', verifyToken, checkPermission(MENU_ID, 'view'), soDtfStokController.exportDetail);

// ============= DATA BIASA =============
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), soDtfStokController.getAll);

// Detail harus DI BAWAH export karena bentrok
router.get('/lookup/cabang', verifyToken, checkPermission(MENU_ID, 'view'), soDtfStokController.getCabangList);

router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), soDtfStokController.getDetails);

router.post('/close', verifyToken, checkPermission(MENU_ID, 'edit'), soDtfStokController.close);

router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), soDtfStokController.remove);

module.exports = router;
