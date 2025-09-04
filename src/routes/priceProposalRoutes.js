const express = require('express');
const router = express.Router();
const priceProposalController = require('../controllers/priceProposalController');
const { verifyToken, checkPermission } = require('../middleware/authMiddleware');

// Definisikan ID Menu untuk Pengajuan Harga
const PRICE_PROPOSAL_MENU_ID = 38;

// GET /api/price-proposals -> Membutuhkan hak 'view' untuk melihat daftar
router.get('/', verifyToken, checkPermission(PRICE_PROPOSAL_MENU_ID, 'view'), priceProposalController.getAll);

// Rute untuk mendapatkan detail penawaran (membutuhkan hak 'view')
router.get('/:nomor', verifyToken, checkPermission(PRICE_PROPOSAL_MENU_ID, 'view'), priceProposalController.getDetails);

// Rute untuk menghapus penawaran (membutuhkan hak 'delete')
router.delete('/:nomor', verifyToken, checkPermission(PRICE_PROPOSAL_MENU_ID, 'delete'), priceProposalController.remove);

module.exports = router;
