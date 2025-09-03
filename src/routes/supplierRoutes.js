const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

// Definisikan ID Menu untuk Supplier
const SUPPLIER_MENU_ID = 8;

/*
 * Middleware untuk rute /save yang menangani 'insert' dan 'edit'.
 */
const checkSavePermission = (req, res, next) => {
    const action = req.body.isNew ? 'insert' : 'edit';
    return checkPermission(SUPPLIER_MENU_ID, action)(req, res, next);
};

// --- Penerapan Middleware pada Rute ---

// Membutuhkan hak 'view' untuk melihat daftar semua supplier
router.get('/', verifyToken, checkPermission(SUPPLIER_MENU_ID, 'view'), supplierController.getAll);

// Menggunakan middleware 'checkSavePermission' untuk menangani insert/edit
router.post('/save', verifyToken, checkSavePermission, supplierController.save);

// Membutuhkan hak 'delete' untuk menghapus
router.delete('/:kode', verifyToken, checkPermission(SUPPLIER_MENU_ID, 'delete'), supplierController.remove);

module.exports = router;
