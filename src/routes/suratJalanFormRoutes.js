const express = require('express');
const router = express.Router();
const sjFormController = require('../controllers/suratJalanFormController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

const MENU_ID = '213'; // Menu ID Surat Jalan ke Store

// Generic lookup
router.get('/lookup/:type', verifyToken, checkPermission(MENU_ID, 'view'), sjFormController.getLookupData);
// Load items from Permintaan or Terima RB
router.get('/load-items', verifyToken, checkPermission(MENU_ID, 'view'), sjFormController.getItemsForLoad);
// Save data
router.post('/save', verifyToken, checkPermission(MENU_ID, 'insert'), sjFormController.save); // Asumsi save untuk insert & edit
// Load data for edit mode
router.get('/:nomor', verifyToken, checkPermission(MENU_ID, 'edit'), sjFormController.loadForEdit);

module.exports = router;
