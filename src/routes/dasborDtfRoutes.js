const express = require('express');
const router = express.Router();
const dasborDtfController = require('../controllers/dasborDtfController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '40'; // Sesuai permintaan Anda

// GET: Mengambil data utama dasbor (master grid)
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), dasborDtfController.getDasborData);

// GET: Mengambil data detail untuk satu tanggal (detail grid)
router.get('/detail', verifyToken, checkPermission(MENU_ID, 'view'), dasborDtfController.getDasborDetail);

// GET: Mengambil daftar cabang untuk filter
router.get('/cabang-list', verifyToken, checkPermission(MENU_ID, 'view'), dasborDtfController.getCabangList);

// GET: Ekspor data header/master ke Excel
router.get('/export-header', verifyToken, checkPermission(MENU_ID, 'view'), dasborDtfController.exportHeader);

// GET: Ekspor data detail gabungan ke Excel
router.get('/export-detail', verifyToken, checkPermission(MENU_ID, 'view'), dasborDtfController.exportDetail);


module.exports = router;
