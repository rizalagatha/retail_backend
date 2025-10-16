const express = require('express');
const router = express.Router();
const refundController = require('../controllers/refundController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

// ID Menu untuk modul Potongan Piutang. Sesuaikan dengan ID di database Anda.
const MENU_ID = '55'; 

// Mengambil daftar master refund
router.get(
  '/master', 
  verifyToken, 
  checkPermission(MENU_ID, 'view'), 
  refundController.getMaster
);

// Mengambil detail satu refund berdasarkan Nomor (Untuk Edit/Lihat)
router.get(
  '/details/:nomor', 
  verifyToken, 
  checkPermission(MENU_ID, 'view'), 
  refundController.getDetails
);

// Mendapatkan data awal untuk form input baru
router.get(
    '/',
    verifyToken,
    // Ubah 'insert' menjadi 'view' atau gabungkan izin
    checkPermission(MENU_ID, 'insert'), 
    refundController.saveRefund
);

// Menyimpan/Membuat data refund baru
router.post(
  '/save', 
  verifyToken, 
  checkPermission(MENU_ID, 'insert_edit'), 
  refundController.saveRefund
);

module.exports = router;