// middleware/aiRateLimiter.js

const chatUsage = new Map();

// Konfigurasi limit
const MAX_REQUESTS = 20; // Maksimal 20 chat
const WINDOW_MS = 60 * 60 * 1000; // Dalam waktu 1 jam

const aiRateLimiter = (req, res, next) => {
  // Ambil identitas user (misal dari token JWT yang sudah di-decode)
  const userId = req.user.cabang;
  const now = Date.now();

  if (!chatUsage.has(userId)) {
    chatUsage.set(userId, { count: 1, resetTime: now + WINDOW_MS });
    return next();
  }

  const userData = chatUsage.get(userId);

  // Jika waktu window sudah lewat, reset kuota
  if (now > userData.resetTime) {
    userData.count = 1;
    userData.resetTime = now + WINDOW_MS;
    return next();
  }

  // Jika masih dalam window waktu, cek kuota
  if (userData.count >= MAX_REQUESTS) {
    const minutesLeft = Math.ceil((userData.resetTime - now) / 60000);
    return res.status(429).json({
      error: true,
      message: `Kuota harian AI Kakak sudah habis untuk mencegah spam. Silakan coba lagi dalam ${minutesLeft} menit.`,
    });
  }

  // Jika masih aman, tambah hitungannya
  userData.count += 1;
  next();
};

module.exports = aiRateLimiter;
