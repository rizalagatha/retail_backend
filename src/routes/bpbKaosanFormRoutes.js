const express = require('express');
const router = express.Router();
const controller = require('../controllers/bpbKaosanFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '221';

router.get('/from-po/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDataFromPO);
router.get('/po-referensi', verifyToken, checkPermission(MENU_ID, 'view'), controller.getPoReferensi);
router.get('/print/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getPrintData);
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.getDataForEdit);
router.post('/', verifyToken, checkPermission(MENU_ID, 'insert'), controller.saveData);
router.put('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), controller.saveData);

module.exports = router;