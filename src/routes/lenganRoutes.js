const express = require('express');
const router = express.Router();
const controller = require('../controllers/lenganController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '203';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getAll);
router.post('/', verifyToken, checkPermission(MENU_ID, 'insert'), controller.save);
router.delete('/:lengan', verifyToken, checkPermission(MENU_ID, 'delete'), controller.remove);

module.exports = router;