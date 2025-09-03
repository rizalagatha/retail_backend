const express = require('express');
const router = express.Router();
const dataProcessController = require('../controllers/dataProcessController');

router.post('/insert-sales-details', dataProcessController.runInsertSalesDetails);
router.post('/insert-cash-payments', dataProcessController.runInsertCashPayments);

module.exports = router;