const express = require('express');
const router = express.Router();
const controller = require('../controllers/terimaRepairFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '212';

router.get('/load-from-kirim', verifyToken, checkPermission(MENU_ID, 'insert'), controller.loadFromKirim);
router.post('/save', verifyToken, checkPermission(MENU_ID, 'insert'), controller.save);

module.exports = router;