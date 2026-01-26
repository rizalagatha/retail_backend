const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

// Rute untuk percobaan login awal
router.post("/login", authController.login);

// Rute untuk menyelesaikan login setelah memilih cabang
router.post("/select-branch", authController.selectBranch);

// [TAMBAHKAN INI] Rute untuk ganti password yang sudah kadaluwarsa (3 bulan)
router.post("/change-expired-password", authController.changeExpiredPassword);

module.exports = router;
