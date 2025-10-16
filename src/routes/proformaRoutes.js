const express = require('express');
const router = express.Router();
const controller = require('../controllers/proformaController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '28';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.get('/details', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDetails);
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), controller.deleteProforma);
router.get('/export-detail', verifyToken, checkPermission(MENU_ID, 'export'), controller.exportDetail);
router.get('/branch-options', verifyToken, controller.getBranchOptions);

module.exports = router;