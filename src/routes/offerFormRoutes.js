const express = require('express');
const router = express.Router();
const offerFormController = require('../controllers/offerFormController');

// GET /api/offer-form/next-number -> Mendapatkan nomor transaksi baru
router.get('/next-number', offerFormController.getNextNumber);

// GET /api/offer-form/search-customers -> Mencari customer
router.get('/search-customers', offerFormController.searchCustomers);

// GET /api/offer-form/customer-details/:kode -> Mendapatkan detail customer
router.get('/customer-details/:kode', offerFormController.getCustomerDetails);

// POST /api/offer-form/save -> Menyimpan data penawaran baru
router.post('/save', offerFormController.saveOffer);

router.get('/get-default-discount', offerFormController.getDefaultDiscount);

router.get('/edit-details/:nomor', offerFormController.getDetailsForEdit);

module.exports = router;
