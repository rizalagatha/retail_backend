const express = require('express');
const router = express.Router();
const historyUpdateController = require('../controllers/historyUpdateController');

router.get('/', historyUpdateController.getHistoryUpdates);

module.exports = router;