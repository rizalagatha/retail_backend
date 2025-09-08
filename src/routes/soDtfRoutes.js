const express = require('express');
const router = express.Router();
const soDtfController = require('../controllers/soDtfController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = 35; // Pastikan ID ini sesuai dengan di database Anda

// GET semua data SO DTF
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), soDtfController.getAll);

// GET detail ukuran untuk satu SO DTF
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), soDtfController.getDetails);

// POST untuk menutup SO DTF
router.post('/close', verifyToken, checkPermission(MENU_ID, 'edit'), soDtfController.close);

// DELETE untuk menghapus SO DTF
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), soDtfController.remove);

module.exports = router;
