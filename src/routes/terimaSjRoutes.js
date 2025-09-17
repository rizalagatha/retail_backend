const express = require('express');
const router = express.Router();
const terimaSjController = require('../controllers/terimaSjController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '31'; // Menu ID untuk Terima SJ

// Daftar SJ yang akan diterima (Browse)
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), terimaSjController.getList);
// Detail item SJ
router.get('/details/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), terimaSjController.getDetails);
// Lookup daftar cabang
router.get('/lookup/cabang', verifyToken, checkPermission(MENU_ID, 'view'), terimaSjController.getCabangList);
// Batalkan penerimaan
router.delete('/:nomorSj/:nomorTerima', verifyToken, checkPermission(MENU_ID, 'delete'), terimaSjController.remove);

router.get('/export-details', verifyToken, checkPermission(MENU_ID, 'view'), terimaSjController.exportDetails);

module.exports = router;
