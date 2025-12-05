// src/routes/userActivityRoutes.js
const express = require("express");
const router = express.Router();
const userActivityController = require("../controllers/userActivityController");
const authMiddleware = require("../middleware/authMiddleware"); // Sesuaikan path middleware auth Anda

// Semua route di sini butuh login (token)
router.use(authMiddleware.verifyToken);

router.post("/log-menu", userActivityController.logMenu);
router.get("/frequent-menus", userActivityController.getFrequentMenus);

module.exports = router;