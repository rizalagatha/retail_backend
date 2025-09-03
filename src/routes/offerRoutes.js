const express = require('express');
const router = express.Router();
const offerController = require('../controllers/offerController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

// Definisikan ID Menu untuk Penawaran
const OFFER_MENU_ID = 42;

/*
 * Middleware untuk rute /save yang menangani 'insert' dan 'edit'.
 */
const checkSavePermission = (req, res, next) => {
    // Asumsikan frontend mengirim 'isNew' flag
    const action = req.body.isNew ? 'insert' : 'edit';
    return checkPermission(OFFER_MENU_ID, action)(req, res, next);
};

// --- Penerapan Middleware pada Rute ---

// Rute untuk data pendukung, cetak, dan export (membutuhkan hak 'view')
router.get('/print-data/:nomor', verifyToken, checkPermission(OFFER_MENU_ID, 'view'), offerController.getPrintData);
router.get('/export-details', verifyToken, checkPermission(OFFER_MENU_ID, 'view'), offerController.getExportDetails);
router.get('/branch-options', verifyToken, checkPermission(OFFER_MENU_ID, 'view'), offerController.getBranchOptions);

// Rute untuk melihat data (membutuhkan hak 'view')
router.get('/', verifyToken, checkPermission(OFFER_MENU_ID, 'view'), offerController.getOffers);
router.get('/:nomor', verifyToken, checkPermission(OFFER_MENU_ID, 'view'), offerController.getOfferDetails);

// Rute untuk menghapus (membutuhkan hak 'delete')
router.delete('/:nomor', verifyToken, checkPermission(OFFER_MENU_ID, 'delete'), offerController.deleteOffer);

// (ASUMSI) Rute untuk menyimpan penawaran baru atau mengubah yang sudah ada
// Anda perlu membuat controller untuk ini.
// router.post('/save', verifyToken, checkSavePermission, offerController.save);

// (ASUMSI) Rute untuk menutup penawaran (dianggap sebagai aksi 'edit')
// Anda perlu membuat controller untuk ini.
router.post('/close', verifyToken, checkPermission(OFFER_MENU_ID, 'edit'), offerController.closeOffer);


module.exports = router;
