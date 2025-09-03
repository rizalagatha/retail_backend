const express = require('express');
const router = express.Router();
const authPinController = require('../controllers/authPinController');

// POST /api/auth-pin/validate -> Endpoint untuk memvalidasi PIN
router.post('/validate', authPinController.validate);

module.exports = router;
