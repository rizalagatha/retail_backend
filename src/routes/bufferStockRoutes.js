const express = require('express');
const router = express.Router();
const bufferStockController = require('../controllers/bufferStockController');

router.post('/update', bufferStockController.update);

module.exports = router;