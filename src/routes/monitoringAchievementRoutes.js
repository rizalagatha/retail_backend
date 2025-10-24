const express = require('express');
const router = express.Router();
const controller = require('../controllers/monitoringAchievementController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '705';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getData);
router.get('/cabang-options', verifyToken, checkPermission(MENU_ID, 'view'), controller.getCabangOptions);

module.exports = router;