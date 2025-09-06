const express = require('express');
const router = express.Router();
const settingHargaController = require('../controllers/settingHargaController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

// menuId 38 digunakan karena terkait langsung dengan Pengajuan Harga
const MENU_ID = 39; 

// GET semua jenis kaos
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), settingHargaController.getAll);

// GET detail jenis kaos untuk diedit
router.get('/:jenisKaos/:custom', verifyToken, checkPermission(MENU_ID, 'edit'), settingHargaController.getDetails);

router.get('/search-jenis-kaos', verifyToken, checkPermission(MENU_ID, 'insert'), settingHargaController.searchJenisKaos);

// POST untuk menyimpan (insert/update)
router.post('/save', verifyToken, checkPermission(MENU_ID, 'insert'), settingHargaController.save);

// DELETE untuk menghapus
router.delete('/', verifyToken, checkPermission(MENU_ID, 'delete'), settingHargaController.remove);

module.exports = router;