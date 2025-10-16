const express = require('express');
const router = express.Router();
const controller = require('../controllers/priceListController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '206';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.get('/details/:kode', verifyToken, checkPermission(MENU_ID, 'view'), controller.getDetails);
router.put('/update', verifyToken, checkPermission(MENU_ID, 'edit'), controller.updatePrices);

module.exports = router;