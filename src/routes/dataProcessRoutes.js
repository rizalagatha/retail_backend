const express = require('express');
const router = express.Router();
const dataProcessController = require('../controllers/dataProcessController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

// Definisikan ID Menu untuk Pengaturan/Proses
const SETTINGS_MENU_ID = 3;

// Menjalankan proses ini dianggap sebagai tindakan 'edit' karena memodifikasi data secara massal.
router.post('/insert-sales-details', verifyToken, checkPermission(SETTINGS_MENU_ID, 'edit'), dataProcessController.runInsertSalesDetails);
router.post('/insert-cash-payments', verifyToken, checkPermission(SETTINGS_MENU_ID, 'edit'), dataProcessController.runInsertCashPayments);

module.exports = router;
