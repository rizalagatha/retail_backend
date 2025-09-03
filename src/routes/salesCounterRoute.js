const express = require('express');
const router = express.Router();
const salesCounterController = require('../controllers/salesCounterController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

// Definisikan ID Menu untuk Sales Counter
const SALES_COUNTER_MENU_ID = 10;

/*
 * Middleware untuk rute /save yang menangani 'insert' dan 'edit'.
 */
const checkSavePermission = (req, res, next) => {
    const action = req.body.isNew ? 'insert' : 'edit';
    return checkPermission(SALES_COUNTER_MENU_ID, action)(req, res, next);
};

// --- Penerapan Middleware pada Rute ---

// Membutuhkan hak 'view' untuk melihat daftar semua sales counter
router.get('/', verifyToken, checkPermission(SALES_COUNTER_MENU_ID, 'view'), salesCounterController.getAll);

// Menggunakan middleware 'checkSavePermission' untuk menangani insert/edit
router.post('/save', verifyToken, checkSavePermission, salesCounterController.save);

// Membutuhkan hak 'delete' untuk menghapus
router.delete('/:kode', verifyToken, checkPermission(SALES_COUNTER_MENU_ID, 'delete'), salesCounterController.remove);

module.exports = router;
