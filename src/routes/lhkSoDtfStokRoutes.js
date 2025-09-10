const express = require('express');
const router = express.Router();
const lhkSoDtfStokController = require('../controllers/lhkSoDtfStokController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '48'; // Asumsi ID Menu untuk LHK SO DTF Stok

// GET: Mengambil daftar LHK Stok berdasarkan filter
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), lhkSoDtfStokController.getAll);

// GET: Mengambil detail untuk satu LHK Stok
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), lhkSoDtfStokController.getDetails);

// GET: Mengambil daftar cabang untuk filter
router.get('/lookup/cabang', verifyToken, checkPermission(MENU_ID, 'view'), lhkSoDtfStokController.getCabangList);

// DELETE: Menghapus satu entri LHK Stok
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), lhkSoDtfStokController.remove);

module.exports = router;