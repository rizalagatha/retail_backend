const express = require('express');
const router = express.Router();
const controller = require('../controllers/mutasiInFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '44'; // Menu ID Mutasi In

const checkSavePermission = (req, res, next) => {
    const action = req.body.isNew ? 'insert' : 'edit';
    return checkPermission(MENU_ID, action)(req, res, next);
};

// Memuat data Mutasi In yang sudah ada untuk mode "Ubah"
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.loadForEdit);

router.get('/search/mutasi-out', verifyToken, checkPermission(MENU_ID, 'view'), controller.searchMutasiOut);
router.get('/export-details', verifyToken, checkPermission(MENU_ID, 'view'), controller.exportDetails);

// Memuat detail item dari Nomor Mutasi Out yang dipilih
router.get('/load-from-mo/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.loadFromMo);

// Menyimpan data Mutasi In (baru atau ubah)
router.post('/save', verifyToken, checkSavePermission, controller.save);

// Endpoint untuk mengambil data cetak
router.get('/print/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getPrintData);

module.exports = router;
