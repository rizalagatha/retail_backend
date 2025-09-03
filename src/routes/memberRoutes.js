const express = require('express');
const router = express.Router();
const memberController = require('../controllers/memberController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

// Definisikan ID Menu untuk Member
const MEMBER_MENU_ID = 7;

/*
 * Middleware untuk rute /save yang menangani 'insert' dan 'edit'.
 */
const checkSavePermission = (req, res, next) => {
    // Jika body request memiliki 'isNew: false', ini adalah 'edit'.
    // Jika tidak, ini 'insert'.
    const action = req.body.isNew ? 'insert' : 'edit';
    return checkPermission(MEMBER_MENU_ID, action)(req, res, next);
};

// --- Penerapan Middleware pada Rute ---

// Membutuhkan hak 'view' untuk melihat daftar semua member
router.get('/', verifyToken, checkPermission(MEMBER_MENU_ID, 'view'), memberController.getAll);

// Menggunakan middleware 'checkSavePermission' untuk menangani insert/edit
router.post('/save', verifyToken, checkSavePermission, memberController.save);

// Membutuhkan hak 'delete' untuk menghapus
router.delete('/:hp', verifyToken, checkPermission(MEMBER_MENU_ID, 'delete'), memberController.remove);

module.exports = router;
