const express = require('express');
const router = express.Router();
const suratJalanController = require('../controllers/suratJalanController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '213'; // ID Menu untuk Surat Jalan ke Store

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), suratJalanController.getList);
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), suratJalanController.getDetails);
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), suratJalanController.remove);

// Endpoint untuk pengajuan perubahan data
router.get('/request-status/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), suratJalanController.getRequestStatus);
router.post('/submit-request', verifyToken, checkPermission(MENU_ID, 'edit'), suratJalanController.submitRequest);
router.get('/export-details', verifyToken, checkPermission(MENU_ID, 'view'), suratJalanController.exportDetails);

router.get('/print-data/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), suratJalanController.getPrintData);

module.exports = router;
