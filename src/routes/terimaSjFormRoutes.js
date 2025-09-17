const express = require('express');
const router = express.Router();
const terimaSjFormController = require('../controllers/terimaSjFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '31'; // Menu ID untuk Terima SJ

// Load data awal untuk form
router.get('/:nomorSj', verifyToken, checkPermission(MENU_ID, 'insert'), terimaSjFormController.load);
// Save data penerimaan
router.post('/save', verifyToken, checkPermission(MENU_ID, 'insert'), terimaSjFormController.save);

module.exports = router;
