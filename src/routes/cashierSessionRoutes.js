const express = require("express");
const router = express.Router();
const cashierSessionController = require("../controllers/cashierSessionController");
const { verifyToken } = require("../middleware/authMiddleware"); // checkPermission dihapus

// --- Penerapan Middleware pada Rute Sesi Kasir ---
// Cukup gunakan verifyToken karena proteksi hak akses menu sudah
// dicegat di Frontend saat user membuka halaman Invoice/Kasir.

// Mengecek status laci kasir saat ini
router.get("/current", verifyToken, cashierSessionController.getCurrentSession);

// Membuat baris sesi baru (Buka Toko/Shift)
router.post("/start", verifyToken, cashierSessionController.startSession);

// Mengupdate status sesi menjadi PAUSED (Istirahat)
router.post("/pause", verifyToken, cashierSessionController.pauseSession);

// Mengambil alih kembali laci (Selesai Istirahat)
router.post("/resume", verifyToken, cashierSessionController.resumeSession);

// Menutup shift secara permanen dan setor fisik
router.post("/end", verifyToken, cashierSessionController.endSession);

module.exports = router;
