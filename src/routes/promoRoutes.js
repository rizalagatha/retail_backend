const express = require('express');
const router = express.Router();
const controller = require('../controllers/promoController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '205';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), controller.remove);

module.exports = router;