const express = require('express');
const router = express.Router();
const controller = require('../controllers/whatsappController');
const { verifyToken } = require('../middleware/authMiddleware');

// Endpoint untuk mengirim struk invoice
router.post('/send-receipt', verifyToken, controller.sendReceipt);
router.get('/status', verifyToken, controller.getStatus);
router.delete('/logout', verifyToken, controller.logout);

module.exports = router;