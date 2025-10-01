const express = require('express');
const router = express.Router();
const controller = require('../controllers/returJualFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '29'; // Menu ID untuk Retur Jual

// GET: Mengambil data dari invoice untuk mengisi form
router.get('/load-from-invoice/:nomorInvoice', verifyToken, checkPermission(MENU_ID, 'insert'), controller.loadFromInvoice);

// GET: Mengambil data retur yang sudah ada untuk mode ubah
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.getForEdit);

// POST: Menyimpan data retur baru atau yang diubah
router.post('/save', verifyToken, controller.save);

// GET: Lookup untuk mencari invoice
router.get('/lookup/invoices', verifyToken, checkPermission(MENU_ID, 'view'), controller.lookupInvoices);

router.get('/lookup/by-barcode/:barcode', verifyToken, checkPermission(MENU_ID, 'view'), controller.findByBarcode);

router.get('/print/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getPrintData);

module.exports = router;