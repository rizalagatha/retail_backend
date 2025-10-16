// routes/potonganRoutes.js
const express = require('express');
const router = express.Router();
const Controller = require('../controllers/potonganFormController');
const customerController = require('../controllers/customerController');

// Route untuk mendapatkan data potongan berdasarkan nomor
router.get('/:nomor', potonganController.getPotonganByNomor);

// Route untuk membuat data potongan baru
router.post('/', potonganController.savePotongan);

// Route untuk mengubah data potongan yang sudah ada
router.put('/:nomor', potonganController.savePotongan);

router.get('/customers/lookup', customerController.getCustomersLookup);


router.get('/customers/:kode', customerController.getCustomerDetailByKode);

module.exports = router;