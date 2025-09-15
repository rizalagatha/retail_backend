const express = require('express');
const router = express.Router();
const mintaBarangController = require('../controllers/mintaBarangController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '37';

// GET: Mengambil daftar Minta Barang berdasarkan filter
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), mintaBarangController.getAll);

// GET: Mengambil detail untuk satu Minta Barang
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), mintaBarangController.getDetails);

// GET: Mengambil daftar cabang untuk filter
router.get('/lookup/cabang', verifyToken, checkPermission(MENU_ID, 'view'), mintaBarangController.getCabangList);

// DELETE: Menghapus satu entri Minta Barang
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), mintaBarangController.remove);

router.get('/export-detail', verifyToken, checkPermission(MENU_ID, 'view'), mintaBarangController.exportDetail);

module.exports = router;
