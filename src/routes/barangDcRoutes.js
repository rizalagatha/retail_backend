const express = require('express');
const router = express.Router();
const controller = require('../controllers/barangDcController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '204';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.get('/details/:kode', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDetails);
router.get('/summary/total', verifyToken, controller.getTotalProducts);

module.exports = router;