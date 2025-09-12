const express = require('express');
const router = express.Router();
const offerFormController = require('../controllers/offerFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const OFFER_MENU_ID = 42;

/*
 * Middleware untuk rute /save yang menangani 'insert' dan 'edit'.
 */
const checkSavePermission = (req, res, next) => {
    const action = req.body.isNew ? 'insert' : 'edit';
    return checkPermission(OFFER_MENU_ID, action)(req, res, next);
};

// Middleware untuk memeriksa hak akses berdasarkan mode (insert/edit) untuk data pendukung
const checkAccessPermission = (req, res, next) => {
    // Mode ditentukan oleh apakah ada 'nomor' di params (untuk edit) atau tidak (untuk insert)
    const action = req.params.nomor ? 'edit' : 'insert';
    return checkPermission(OFFER_MENU_ID, action)(req, res, next);
};

// GET /api/offer-form/next-number -> Mendapatkan nomor transaksi baru
router.get('/next-number', verifyToken, checkPermission(OFFER_MENU_ID, 'insert'), offerFormController.getNextNumber);

// GET /api/offer-form/search-customers -> Mencari customer
router.get('/search-customers', offerFormController.searchCustomers);

// GET /api/offer-form/customer-details/:kode -> Mendapatkan detail customer
router.get('/customer-details/:kode', verifyToken, checkAccessPermission, offerFormController.getCustomerDetails);

// POST /api/offer-form/save -> Menyimpan data penawaran baru
router.post('/save',  verifyToken, checkSavePermission,  offerFormController.saveOffer);

router.get('/get-default-discount', verifyToken, checkAccessPermission, offerFormController.getDefaultDiscount);

router.get('/edit-details/:nomor', verifyToken, checkAccessPermission, offerFormController.getDetailsForEdit);

// GET: Mencari SO DTF yang tersedia untuk ditambahkan ke penawaran
router.get('/search/so-dtf', verifyToken, checkPermission(OFFER_MENU_ID, 'view'), offerFormController.searchSoDtf);
router.get('/search/so-dtf-details/:nomor', verifyToken, checkPermission(OFFER_MENU_ID, 'view'), offerFormController.getSoDtfDetails);

// GET: Mencari Pengajuan Harga yang sudah disetujui
router.get('/search/price-proposals', verifyToken, checkPermission(OFFER_MENU_ID, 'view'), offerFormController.searchPriceProposals);

router.get('/print-data/:nomor', verifyToken, checkPermission(OFFER_MENU_ID, 'view'), offerFormController.getPrintData);

module.exports = router;
