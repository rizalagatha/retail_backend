const express = require('express');
const router = express.Router();
const controller = require('../controllers/returDcController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '32';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.get('/details/:nomor', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDetails);
router.delete('/:nomor', verifyToken, checkPermission(MENU_ID, 'delete'), controller.remove);

module.exports = router;