const express = require('express');
const router = express.Router();
const warehouseController = require('../controllers/warehouseController');

router.get('/', warehouseController.search);
router.get('/list', warehouseController.getBranchList);
router.get('/so-dtf-branches', warehouseController.getSoDtfBranchList);

module.exports = router;
