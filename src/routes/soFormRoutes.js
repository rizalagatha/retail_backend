const express = require('express');
const router = express.Router();
const soFormController = require('../controllers/soFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '26'; // ID Menu Surat Pesanan

const checkSavePermission = (req, res, next) => {
    const action = req.body.isNew ? 'insert' : 'edit';
    return checkPermission(MENU_ID, action)(req, res, next);
};

// GET: Memuat semua data yang dibutuhkan untuk form mode "Ubah"
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), soFormController.getForEdit);

// POST: Menyimpan data SO (bisa untuk baru atau update)
router.post('/save', verifyToken, checkSavePermission, soFormController.save);

// --- Rute untuk Form Bantuan (Lookups) ---
router.get('/lookup/penawaran', verifyToken, checkPermission(MENU_ID, 'view'), soFormController.searchPenawaran);
router.get('/lookup/penawaran-details/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), soFormController.getPenawaranDetails);
router.get('/lookup/default-discount', verifyToken, checkPermission(MENU_ID, 'view'), soFormController.getDefaultDiscount);
router.get('/lookup/jenis-order', verifyToken, checkPermission(MENU_ID, 'view'), soFormController.searchJenisOrder);
router.post('/hitung-harga', verifyToken, checkPermission(MENU_ID, 'view'), soFormController.hitungHarga);
router.post("/hitung-harga-custom", verifyToken, checkPermission(MENU_ID, 'view'), soFormController.calculateHargaCustom);
// GET: Mencari setoran yang tersedia untuk di-link sebagai DP
router.get('/lookup/setoran', verifyToken, checkPermission(MENU_ID, 'view'), soFormController.searchSetoran);
router.get('/lookup/rekening', verifyToken, checkPermission(MENU_ID, 'view'), soFormController.searchRekening);

router.get('/print-data/dp/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), soFormController.getDpPrintData);
router.get('/by-barcode/:barcode', verifyToken, soFormController.getByBarcode);

// POST: Menyimpan data DP baru dari modal
router.post('/save-dp', verifyToken, checkPermission(MENU_ID, 'insert'), soFormController.saveDp);

router.post('/delete-dp', verifyToken, checkPermission(MENU_ID, 'edit'), soFormController.deleteDp);

module.exports = router;
