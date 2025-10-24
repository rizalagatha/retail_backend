const express = require('express');
const router = express.Router();
const controller = require('../controllers/klerekController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '34';

router.get('/', verifyToken, checkPermission(MENU_ID, 'view'), controller.getList);
router.post('/proses', verifyToken, checkPermission(MENU_ID, 'insert'), controller.prosesKlerek);
router.get('/cabang-options', verifyToken, controller.getCabangOptions);

module.exports = router;