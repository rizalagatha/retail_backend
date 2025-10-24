const express = require('express');
const router = express.Router();
const controller = require('../controllers/approvePengajuanProduksiFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '218';

router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.getDataForApprove);
router.put('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.saveApproval);

module.exports = router;