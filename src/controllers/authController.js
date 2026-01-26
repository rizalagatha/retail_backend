const authService = require("../services/authService");
const auditService = require("../services/auditService"); // Import Audit Service
const jwt = require("jsonwebtoken");

// Helper lokal untuk cek waktu dan catat log
const checkAndLogSuspiciousLogin = (req, user, cabang) => {
  // 1. Guard Clause: Jika data user tidak valid, skip
  if (!user) return;

  // 2. Pengecualian Cabang KDC
  if (cabang === "KDC" || cabang === "KPR") return;

  // 3. Pengecualian Admin/Developer
  const username = (
    user.nama ||
    user.username ||
    user.kode ||
    ""
  ).toLowerCase();
  if (username.includes("admin") || username === "developer") return;

  // 4. Timezone Logic (WIB / Asia Jakarta)
  // Ubah waktu server ke waktu Jakarta
  const serverTime = new Date();
  const jakartaTime = new Date(
    serverTime.toLocaleString("en-US", { timeZone: "Asia/Jakarta" }),
  );

  const hours = jakartaTime.getHours();
  const minutes = jakartaTime.getMinutes();
  const currentTime = hours * 100 + minutes; // Format HHMM (ex: 300 untuk jam 03:00)

  // LOG DEBUG (Bisa dihapus nanti jika sudah oke)
  // (`[AUDIT DEBUG] User: ${user.kode}, Cabang: ${cabang}, JamWIB: ${currentTime}`);

  // 5. Kondisi Waktu: < 08:30 ATAU >= 21:30
  if (currentTime < 830 || currentTime >= 2130) {
    // Inject manual ke req.user agar auditService bisa baca
    req.user = {
      kode: user.kode || user.user_kode || user.id, // Prioritas kode
      nama: user.nama || user.username,
      cabang: cabang || user.cabang,
    };

    // Ambil target ID
    const targetId = req.user.kode;
    const timeString = jakartaTime.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });

    auditService.logActivity(
      req,
      "LOGIN",
      "USER",
      targetId,
      null,
      null,
      `Login di luar jam operasional (Pukul ${timeString})`,
    );
  }
};

const login = async (req, res) => {
  try {
    const { kodeUser, password } = req.body;
    const result = await authService.loginUser(kodeUser, password);

    // 1. Cek interupsi ganti password (Wajib 3 Bulan)
    if (result.requiresPasswordChange) {
      return res.json(result);
    }

    // 2. Logic Audit & Response Normal
    const actualUser = result.user || (result.data && result.data.user);
    const actualCabang = actualUser ? actualUser.cabang : null;
    const hasToken = result.token || (result.data && result.data.token);

    if (hasToken && actualUser) {
      checkAndLogSuspiciousLogin(req, actualUser, actualCabang);
    }

    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

/**
 * Controller untuk menangani pembaruan password yang expired
 */
const changeExpiredPassword = async (req, res) => {
  try {
    const { tempToken, newPassword } = req.body;

    // 1. Verifikasi token temporer ganti password
    const decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
    if (!decoded.isChangingPassword) {
      return res
        .status(403)
        .json({ message: "Token tidak valid untuk ganti password." });
    }

    // 2. Eksekusi update di database via service
    const result = await authService.updateExpiredPassword(
      decoded.kode,
      newPassword,
    );

    // 3. Catat aktivitas ke Audit Trail
    auditService.logActivity(
      req,
      "CHANGE_PASSWORD_EXPIRED",
      "USER",
      decoded.kode,
      null,
      null,
      "User melakukan pembaruan password wajib (siklus 3 bulan)",
    );

    res.json(result);
  } catch (error) {
    const message =
      error.name === "JsonWebTokenError"
        ? "Sesi habis, silakan login ulang."
        : error.message;
    res.status(400).json({ message });
  }
};

const selectBranch = async (req, res) => {
  try {
    const { tempToken, selectedCabang } = req.body;

    // Finalize login akan mengembalikan token valid dan data user
    const result = await authService.finalizeLoginWithBranch(
      tempToken,
      selectedCabang,
    );

    // [PERBAIKAN UTAMA DISINI JUGA]
    const actualUser = result.user || (result.data && result.data.user);

    // Jika finalize login berhasil, token pasti ada
    const hasToken = result.token || (result.data && result.data.token);

    if (hasToken && actualUser) {
      // Pastikan cabang yang dipakai adalah yang dipilih user
      checkAndLogSuspiciousLogin(req, actualUser, selectedCabang);
    }

    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

module.exports = {
  login,
  selectBranch,
  changeExpiredPassword,
};
