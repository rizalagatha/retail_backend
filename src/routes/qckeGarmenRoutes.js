const express = require('express');
const router = express.Router();
const qckeGarmenController = require('../controllers/qckeGarmenController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

// Definisikan ID Menu untuk Penawaran
const OFFER_MENU_ID = 42;

router.get('/master', controller.getMaster);
router.get('/details/:nomor', controller.getDetails);
router.delete('/master/:nomor', controller.deleteMaster);

module.exports = router;