const express = require('express');
const router = express.Router();
const controller = require('../controllers/qckeGarmenFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '215'; // Asumsi

// ✅ Route spesifik dulu
router.get('/gudang-options', verifyToken, controller.getGudangOptions);
// F1 (Grid 1 & 2) - Ambil semua barang
router.get('/barang-lookup/all', verifyToken, controller.getBarangLookup);
// F2 (Grid 2) - Ambil varian
router.get('/barang-lookup/varian', verifyToken, controller.getVarianBarang);
// Enter (Grid 1)
router.get('/product-by-barcode/grid1', verifyToken, controller.getProductByBarcodeGrid1);
// Enter (Grid 2)
router.get('/product-by-barcode/grid2', verifyToken, controller.getProductByBarcodeGrid2);

// ✅ Route yang bisa tangkap semua path di akhir
router.get('/print/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getPrintData);
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.getDataForEdit);
router.post('/', verifyToken, checkPermission(MENU_ID, 'insert'), controller.saveData);
router.put('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.saveData);

module.exports = router;
