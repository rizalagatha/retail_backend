const express = require('express');
const router = express.Router();
const controller = require('../controllers/invoiceFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '27';

// Middleware khusus untuk memvalidasi izin simpan (insert/edit)
const checkSavePermission = (req, res, next) => {
    const action = req.body.isNew ? 'insert' : 'edit';
    return checkPermission(MENU_ID, action)(req, res, next);
};

// --- ROUTES ---

// Memuat data Invoice yang sudah ada untuk mode "Ubah"
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.loadForEdit);

// Menyimpan data (baru atau yang diubah)
router.post('/save', verifyToken, checkSavePermission, controller.save);

// --- LOOKUP ROUTES ---
// Mencari SO yang valid untuk diinput
router.get('/lookup/so', verifyToken, checkPermission(MENU_ID, 'view'), controller.searchSo);

router.get('/lookup/promo', verifyToken, checkPermission(MENU_ID, 'view'), controller.searchPromo);

router.get('/lookup/member/:hp', verifyToken, checkPermission(MENU_ID, 'view'), controller.getMemberByHp);

router.get('/lookup/default-customer', verifyToken, controller.getDefaultCustomer);

router.post('/save-member', verifyToken, checkPermission(MENU_ID, 'insert'), controller.saveMember);

// Mengambil detail item dari SO yang dipilih untuk mengisi grid
router.get('/lookup/so-details/:soNomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getSoDetailsForGrid);

router.get('/lookup/sales-counters', verifyToken, checkPermission(MENU_ID, 'view'), controller.getSalesCounters);

// Mencari DP (Setoran) yang belum lunas milik customer
router.get('/lookup/unpaid-dp/:customerKode', verifyToken, checkPermission(MENU_ID, 'view'), controller.searchUnpaidDp);

module.exports = router;

