const express = require('express');
const router = express.Router();
const controller = require('../controllers/kartuPiutangController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '52'; // Menu ID untuk Kartu Piutang

// Endpoint utama untuk mendapatkan daftar piutang per customer
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getCustomerReceivables);

// Endpoint untuk mengisi dropdown filter cabang
router.get('/lookup/cabang', verifyToken, checkPermission(MENU_ID, 'view'), controller.getCabangOptions);

router.get('/invoices/:customerKode', verifyToken, checkPermission(MENU_ID, 'view'), controller.getInvoiceList);

router.get('/payment-details/:piutangHeaderNomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getPaymentDetails);

module.exports = router;