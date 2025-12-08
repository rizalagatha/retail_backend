const express = require('express');
const router = express.Router();
const healthController = require('../controllers/healthController');

// Route GET / (nanti akan dipasang di prefix /health-check)
router.get('/', healthController.checkHealth);

module.exports = router;