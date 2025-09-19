const express = require('express');
const router = express.Router();
const controller = require('../controllers/setoranBayarFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '51';

const checkSavePermission = (req, res, next) => {
    const action = req.body.isNew ? 'insert' : 'edit';
    return checkPermission(MENU_ID, action)(req, res, next);
};

// --- ROUTES UTAMA ---
// Memuat data Setoran yang sudah ada untuk mode "Ubah"
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.loadForEdit);

// Menyimpan data (baru atau ubah)
router.post('/save', verifyToken, checkSavePermission, controller.save);

// --- ROUTES UNTUK LOOKUP MODAL ---
// Mencari invoice yang belum lunas
router.get('/lookup/unpaid-invoices', verifyToken, checkPermission(MENU_ID, 'view'), controller.searchUnpaidInvoices);

router.get('/print/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getPrintData);

module.exports = router;

