const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

// Rute untuk percobaan login awal
router.post("/login", authController.login);

// Rute untuk menyelesaikan login setelah memilih cabang
router.post("/select-branch", authController.selectBranch);

// [TAMBAHKAN INI] Rute untuk ganti password yang sudah kadaluwarsa (3 bulan)
router.post("/change-expired-password", authController.changeExpiredPassword);

// routes/authRoutes.js

// [TAMBAHAN INI] Rute untuk mengecek apakah client berada di jaringan LAN
router.get("/check-ip", (req, res) => {
  // Ambil IP dari header proxy (jika pakai Nginx) atau langsung dari connection
  const clientIp =
    req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";

  // Fungsi untuk mengecek apakah IP termasuk IP Private/Lokal (LAN)
  const isLanIp = (ip) => {
    if (!ip) return false;

    // IPv4 localhost
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1")
      return true;

    // Pattern untuk IP Lokal (192.168.x.x, 10.x.x.x, 172.16.x.x - 172.31.x.x)
    const ip4Pattern =
      /^(::ffff:)?(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/;
    return ip4Pattern.test(ip);
  };

  res.json({
    ip: clientIp,
    isLocal: isLanIp(clientIp),
  });
});

module.exports = router;
