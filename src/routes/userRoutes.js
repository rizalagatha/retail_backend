const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

// Definisikan ID Menu untuk Master User
const USER_MENU_ID = 1; // Pastikan ID ini sesuai dengan di database Anda

/*
 * Middleware untuk rute /save yang menangani 'insert' dan 'edit'.
 */
const checkSavePermission = (req, res, next) => {
    const action = req.body.isNewUser ? 'insert' : 'edit';
    return checkPermission(USER_MENU_ID, action)(req, res, next);
};


// --- RUTE BARU ---
// Endpoint ini mungkin tidak perlu proteksi spesifik jika hanya untuk data pendukung
router.get('/available-for-sc', verifyToken, userController.getAvailableForSalesCounter);


// --- Rute yang sudah ada ---
// Rute-rute ini umumnya butuh hak 'view' untuk bisa diakses
router.get('/', verifyToken, checkPermission(USER_MENU_ID, 'view'), userController.getAll);
router.get('/branches', verifyToken, checkPermission(USER_MENU_ID, 'view'), userController.getBranches);
router.get('/menus', verifyToken, checkPermission(USER_MENU_ID, 'view'), userController.getMenus);

// Rute ini membutuhkan hak insert atau edit
router.post('/save', verifyToken, checkSavePermission, userController.save);

// Mengubah password adalah bagian dari 'edit'
router.post('/change-password', verifyToken, checkPermission(USER_MENU_ID, 'edit'), userController.updatePassword);

// Menghapus user membutuhkan hak 'delete'
// PERHATIAN: Rute Anda menggunakan POST/DELETE dengan body, ini tidak standar.
// Sebaiknya gunakan DELETE /api/users/:kode/:cabang
router.delete('/delete', verifyToken, checkPermission(USER_MENU_ID, 'delete'), userController.remove);

// Rute dinamis untuk mendapatkan detail (membutuhkan hak 'view')
router.get('/:kode/:cabang', verifyToken, checkPermission(USER_MENU_ID, 'view'), userController.getDetails);


module.exports = router;
