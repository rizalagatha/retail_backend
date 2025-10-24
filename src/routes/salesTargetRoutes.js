const express = require('express');
const router = express.Router();
const controller = require('../controllers/salesTargetController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '509';

// Existing route for the main report
router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);

// New route for the dynamic branch options
router.get('/dynamic-cabang-options', verifyToken, controller.getDynamicCabangOptions);

module.exports = router;