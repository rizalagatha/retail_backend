const express = require('express');
const router = express.Router();
const priceProposalController = require('../controllers/priceProposalController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

// Definisikan ID Menu untuk Pengajuan Harga
const PRICE_PROPOSAL_MENU_ID = 38;

// GET /api/price-proposals -> Membutuhkan hak 'view' untuk melihat daftar
router.get('/', verifyToken, checkPermission(PRICE_PROPOSAL_MENU_ID, 'view'), priceProposalController.getAll);

// Endpoint lain untuk CRUD (Contoh implementasi di masa depan)
// router.post('/save', verifyToken, checkPermission(PRICE_PROPOSAL_MENU_ID, 'insert'), ...);
// router.put('/save/:nomor', verifyToken, checkPermission(PRICE_PROPOSAL_MENU_ID, 'edit'), ...);
// router.delete('/:nomor', verifyToken, checkPermission(PRICE_PROPOSAL_MENU_ID, 'delete'), ...);

module.exports = router;
