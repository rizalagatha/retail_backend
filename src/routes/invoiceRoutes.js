const express = require('express');
const router = express.Router();
const controller = require('../controllers/invoiceController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '27';

// Endpoint utama untuk mendapatkan daftar invoice
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);

// Endpoint untuk mendapatkan detail invoice (expanded row)
router.get('/details/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDetails);

// Endpoint untuk mendapatkan daftar cabang untuk filter
router.get('/lookup/cabang', verifyToken, checkPermission(MENU_ID, 'view'), controller.getCabangList);

// Endpoint untuk menghapus invoice
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), controller.remove);

// Endpoint untuk export detail
router.get('/export-details', verifyToken, checkPermission(MENU_ID, 'view'), controller.exportDetails);


module.exports = router;
