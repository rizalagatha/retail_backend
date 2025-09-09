const express = require('express');
const router = express.Router();
const priceProposalFormController = require('../controllers/priceProposalFormController');
const upload = require('../middleware/uploadMiddleware');
const { verifyToken, checkPermission, checkInsertOrEditPermission } = require('../middleware/authMiddleware');

// Definisikan ID Menu untuk Pengajuan Harga
const PRICE_PROPOSAL_MENU_ID = 38;

// Middleware untuk rute /save yang menangani 'insert' dan 'edit'
const checkSavePermission = (req, res, next) => {
    const action = req.body.isNew ? 'insert' : 'edit';
    return checkPermission(PRICE_PROPOSAL_MENU_ID, action)(req, res, next);
};

// --- RUTE YANG SUDAH DIAMANKAN ---

// Butuh hak 'insert' ATAU 'edit' untuk mengakses data bantuan form
router.get('/search-tshirt-types', verifyToken, checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID), priceProposalFormController.searchTshirtTypes);
router.get('/tshirt-type-details', verifyToken, checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID), priceProposalFormController.getTshirtTypeDetails);
router.get('/get-discount', verifyToken, checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID), priceProposalFormController.getDiscount);
router.get('/search-products-by-type', verifyToken, checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID), priceProposalFormController.searchProductsByType);
router.get('/search-additional-costs', verifyToken, checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID), priceProposalFormController.searchAdditionalCosts);

// Hanya butuh hak 'insert' untuk mendapatkan nomor baru
router.get('/next-number', verifyToken, checkPermission(PRICE_PROPOSAL_MENU_ID, 'insert'), priceProposalFormController.getNextNumber);

// Hanya butuh hak 'edit' untuk memuat data lama
router.get('/:nomor', verifyToken, checkPermission(PRICE_PROPOSAL_MENU_ID, 'edit'), priceProposalFormController.getForEdit);

// Rute 'save' dan 'upload' membutuhkan hak 'insert' ATAU 'edit'
router.post('/save', verifyToken, checkPermission(PRICE_PROPOSAL_MENU_ID, ['insert', 'edit']), priceProposalFormController.save);
router.post(
    '/upload-image/:nomor',
    verifyToken,
    checkPermission(PRICE_PROPOSAL_MENU_ID, 'edit'),
    upload.single('image'),
    priceProposalFormController.uploadImage
);

module.exports = router;