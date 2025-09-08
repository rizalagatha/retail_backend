const express = require('express');
const router = express.Router();
const lhkSoDtfController = require('../controllers/lhkSoDtfController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '41'; 

// GET: Mengambil daftar LHK SO DTF berdasarkan filter
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), lhkSoDtfController.getAll);

// GET: Mengambil daftar cabang/store untuk filter
router.get('/cabang-list', verifyToken, checkPermission(MENU_ID, 'view'), lhkSoDtfController.getCabangList);

// DELETE: Menghapus satu entri LHK
// Kita gunakan query params karena key-nya komposit (tanggal, sodtf, cabang)
router.delete('/', verifyToken, checkPermission(MENU_ID, 'delete'), lhkSoDtfController.remove);

module.exports = router;
