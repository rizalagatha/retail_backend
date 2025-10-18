const express = require('express');
const router = express.Router();
const controller = require('../controllers/healthController');

// Rute ini tidak perlu token, bisa diakses siapa saja
router.get('/', controller.check);

module.exports = router;