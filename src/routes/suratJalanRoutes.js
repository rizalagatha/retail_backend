const express = require('express');
const router = express.Router();
const suratJalanController = require('../controllers/suratJalanController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '213'; 

// GET: Mengambil daftar Surat Jalan berdasarkan filter
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), suratJalanController.getAll);

// GET: Mengambil detail untuk satu Surat Jalan
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), suratJalanController.getDetails);

// DELETE: Menghapus satu entri Surat Jalan
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), suratJalanController.remove);

// POST: Mengajukan perubahan data
router.post('/request-change', verifyToken, checkPermission(MENU_ID, 'edit'), suratJalanController.requestChange);

module.exports = router;
