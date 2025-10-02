const express = require('express');
const router = express.Router();
const controller = require('../controllers/terimaReturController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '214';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.get('/details/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDetails);
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), controller.cancelReceipt);
router.post('/submit-change-request', verifyToken, checkPermission(MENU_ID, 'edit'), controller.submitChangeRequest);

module.exports = router;