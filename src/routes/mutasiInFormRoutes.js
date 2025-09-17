const express = require('express');
const router = express.Router();
const controller = require('../controllers/mutasiInFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '44'; // Menu ID Mutasi In

// Endpoint untuk mengambil data cetak
router.get('/print/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getPrintData);

module.exports = router;
