const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/login', authController.login);
router.post('/select-branch', authController.selectBranch); 

module.exports = router;