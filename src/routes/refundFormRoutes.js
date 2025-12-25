const express = require('express');
const router = express.Router();
const controller = require('../controllers/refundFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '55'; // Sesuai permintaan

router.get('/lookup/invoice', verifyToken, checkPermission(MENU_ID, 'view'), controller.getInvoiceLookup);
router.get('/lookup/deposit', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDepositLookup);
router.get(
  "/lookup/so-details/:soNomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
   controller.getSoDetailsForRefund
);
router.get('/print/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getPrintData);
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.getDataForEdit);
router.post('/', verifyToken, checkPermission(MENU_ID, 'insert'), controller.saveData);
router.put('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.saveData);

module.exports = router;