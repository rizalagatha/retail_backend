const express = require('express');
const router = express.Router();
const mutasiOutController = require('../controllers/mutasiOutController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '43'; // Sesuai permintaan Anda

// GET: Mengambil daftar Mutasi Out berdasarkan filter
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), mutasiOutController.getAll);

// GET: Mengambil detail untuk satu Mutasi Out
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), mutasiOutController.getDetails);

// GET: Mengambil daftar cabang untuk filter
router.get('/lookup/cabang', verifyToken, checkPermission(MENU_ID, 'view'), mutasiOutController.getCabangList);

// DELETE: Menghapus satu entri Mutasi Out
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), mutasiOutController.remove);

module.exports = router;
