const express = require('express');
const router = express.Router();
const lhkSoDtfFormController = require('../controllers/lhkSoDtfFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '41'; // ID Menu LHK SO DTF

// GET: Memuat semua data LHK untuk tanggal dan cabang tertentu
router.get('/:tanggal/:cabang', verifyToken, checkPermission(MENU_ID, 'view'), lhkSoDtfFormController.loadData);

// GET: Mencari SO DTF / PO DTF untuk ditambahkan ke grid
router.get('/search/so-po', verifyToken, checkPermission(MENU_ID, 'view'), lhkSoDtfFormController.searchSoPo);

// POST: Menyimpan seluruh data LHK untuk satu hari (delete-then-insert)
router.post('/', verifyToken, checkPermission(MENU_ID, ['insert', 'edit']), lhkSoDtfFormController.saveData);

module.exports = router;
