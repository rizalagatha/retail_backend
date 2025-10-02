const express = require('express');
const router = express.Router();
const controller = require('../controllers/terimaReturFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '214'; // Menu ID untuk Terima Retur dari Store

// GET: Mengambil data dari dokumen pengiriman retur untuk mengisi form
router.get('/load-from-kirim/:nomorKirim', verifyToken, checkPermission(MENU_ID, 'insert'), controller.loadFromKirim);

// GET: Mengambil data penerimaan retur yang sudah ada untuk mode ubah
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.getForEdit);

// POST: Menyimpan data penerimaan retur baru atau yang diubah
router.post('/save', verifyToken, controller.save);

module.exports = router;