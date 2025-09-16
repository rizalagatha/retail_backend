const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Rute untuk percobaan login awal
router.post('/login', authController.login);

// Rute untuk menyelesaikan login setelah memilih cabang
router.post('/select-branch', authController.selectBranch);

module.exports = router;
