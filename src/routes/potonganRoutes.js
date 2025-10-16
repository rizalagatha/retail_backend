// routes/potonganRoutes.js
const express = require('express');
const router = express.Router();
const controller = require('../controllers/potonganController'); // Controller yang baru dibuat
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

// ID Menu untuk modul Potongan Piutang. Sesuaikan dengan ID di database Anda.
const MENU_ID = '53'; // Menggunakan ID 28 sesuai asumsi sebelumnya



// Mengambil daftar Cabang/Gudang yang dapat diakses (Options untuk filter)
router.get('/lookup/cabang-options', verifyToken,  checkPermission(MENU_ID, 'view'), 
    controller.getCabangList
);

// --- Routes Utama (List, Detail, CRUD) ---

// [GET] Rute utama untuk mendapatkan daftar Potongan (List View)
router.get('/master', 
    verifyToken, 
    checkPermission(MENU_ID, 'view'), 
    controller.getPotonganList
);

// [GET] Mengambil detail satu Potongan berdasarkan Nomor (Untuk Edit/Lihat)
router.get('/detail/:nomor', 
    verifyToken, 
    checkPermission(MENU_ID, 'view'), 
    controller.getPotonganDetails
);

// [POST] Menyimpan/Membuat data Potongan baru
router.post('/', 
    verifyToken, 
    checkPermission(MENU_ID, 'insert'), 
    controller.savePotongan
);

// [PUT] Mengubah data Potongan yang sudah ada
// Kita bisa menggunakan POST di atas untuk Create/Update (seperti di model.save),
// tetapi jika Anda ingin endpoint terpisah:
router.put('/:nomor', 
    verifyToken, 
    checkPermission(MENU_ID, 'edit'), 
    controller.savePotongan
);

// [DELETE] Menghapus data Potongan
router.delete('/:nomor', 
    verifyToken, 
    checkPermission(MENU_ID, 'delete'), 
    controller.deletePotongan
);

// --- Routes Export ---

// [GET] Mengambil data detail untuk Export ke Excel
router.get('/export/detail', 
    verifyToken, 
    checkPermission(MENU_ID, 'view'), 
    controller.exportPotonganDetails
);


module.exports = router;