const express = require('express');
const router = express.Router();
const suratJalanController = require('../controllers/suratJalanController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '213'; // ID Menu untuk Surat Jalan ke Store

// 1. Static Routes FIRST
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), suratJalanController.getList);
router.get('/lookup/cabang', verifyToken, checkPermission(MENU_ID, 'view'), suratJalanController.getCabangList);
router.get('/export-details', verifyToken, checkPermission(MENU_ID, 'view'), suratJalanController.exportDetails); // <--- MOVE UP HERE

// 2. Dynamic Routes LAST
router.get('/request-status/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), suratJalanController.getRequestStatus);
router.post('/submit-request', verifyToken, checkPermission(MENU_ID, 'edit'), suratJalanController.submitRequest);
router.get('/print-data/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), suratJalanController.getPrintData);

// :nomor matches anything, so it must be last
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), suratJalanController.getDetails); 
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), suratJalanController.remove);

module.exports = router;
