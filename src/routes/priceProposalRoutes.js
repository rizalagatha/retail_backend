const express = require('express');
const router = express.Router();
const priceProposalController = require('../controllers/priceProposalController');

// GET /api/price-proposals -> Mengambil daftar pengajuan harga
router.get('/', priceProposalController.getAll);

// Endpoint lain untuk CRUD akan ditambahkan di sini nanti
// router.post('/save', ...);
// router.delete('/:nomor', ...);

module.exports = router;
