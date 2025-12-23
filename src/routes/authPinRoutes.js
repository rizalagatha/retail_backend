const express = require("express");
const router = express.Router();
const controller = require("../controllers/authPinController");
const { verifyToken } = require("../middleware/authMiddleware"); // Pastikan path middleware benar

// --- SALES SIDE ---

// POST /api/authorization/request
// Body: { transaksi, jenis, keterangan, nominal }
// Fungsi: Sales mengirim request otorisasi baru
router.post("/request", verifyToken, controller.createRequest);

// GET /api/authorization/status/:nomor
// Param: nomor (authNomor yang didapat saat createRequest)
// Fungsi: Cek apakah sudah diapprove (Polling)
router.get("/status/:nomor", verifyToken, controller.checkStatus);

// --- MANAGER SIDE ---

// GET /api/authorization/pending
// Fungsi: Manager melihat daftar otorisasi yang belum diproses di cabangnya
router.get("/pending", verifyToken, controller.getPending);

// POST /api/authorization/process
// Body: { authNomor, action: 'APPROVE' | 'REJECT' }
// Fungsi: Manager menyetujui atau menolak
router.post("/process", verifyToken, controller.processRequest);

module.exports = router;
