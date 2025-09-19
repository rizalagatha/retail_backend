const express = require('express');
const router = express.Router();
const controller = require('../controllers/fskFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '54';

const checkSavePermission = (req, res, next) => {
    const action = req.body.isNew ? 'insert' : 'edit';
    return checkPermission(MENU_ID, action)(req, res, next);
};

// GET: Memuat data setoran otomatis berdasarkan tanggal untuk form baru
router.get('/load-initial', verifyToken, checkPermission(MENU_ID, 'insert'), controller.loadInitialData);

// GET: Memuat data FSK yang sudah ada untuk mode "Ubah"
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.loadForEdit);

// POST: Menyimpan data FSK (baru atau ubah)
router.post('/save', verifyToken, checkSavePermission, controller.save);

router.get('/print/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getPrintData);

router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), controller.remove);

module.exports = router;
