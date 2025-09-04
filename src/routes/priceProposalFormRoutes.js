const express = require('express');
const router = express.Router();
const priceProposalFormController = require('../controllers/priceProposalFormController');
const upload = require('../middleware/uploadMiddleware');

// GET /api/price-proposal-form/next-number -> Mendapatkan nomor transaksi baru
router.get('/next-number', priceProposalFormController.getNextNumber);

// GET /api/price-proposal-form/search-tshirt-types -> Mencari jenis kaos (untuk F1)
router.get('/search-tshirt-types', priceProposalFormController.searchTshirtTypes);

// GET /api/price-proposal-form/tshirt-type-details -> Mengambil detail harga per ukuran
router.get('/tshirt-type-details', priceProposalFormController.getTshirtTypeDetails);

// POST /api/price-proposal-form/save -> Menyimpan data pengajuan harga baru atau yang diubah
// router.post('/save', priceProposalFormController.save);

// (Endpoint untuk mode "Ubah" akan kita tambahkan di sini nanti saat diperlukan)
// router.get('/edit-details/:nomor', priceProposalFormController.getDetailsForEdit);
router.post('/upload-image', upload.single('proposalImage'), priceProposalFormController.uploadImage);

router.get('/get-discount', priceProposalFormController.getDiscount);

router.get('/search-products-by-type', priceProposalFormController.searchProductsByType);

module.exports = router;