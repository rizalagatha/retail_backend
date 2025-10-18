const express = require('express');
const router = express.Router();
const controller = require('../controllers/stokOpnameSettingController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '21';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.post('/', verifyToken, checkPermission(MENU_ID, 'insert'), controller.setDate);
router.delete('/:tanggal', verifyToken, checkPermission(MENU_ID, 'delete'), controller.deleteDate);

module.exports = router;