const authService = require("../services/authService");
const auditService = require("../services/auditService"); // Import Audit Service

// Helper lokal untuk cek waktu dan catat log
const checkAndLogSuspiciousLogin = (req, user, cabang) => {
  // 1. Guard Clause: Jika data user tidak valid, skip
  if (!user) return;

  // 2. Pengecualian Cabang KDC
  if (cabang === "KDC") return;

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
    serverTime.toLocaleString("en-US", { timeZone: "Asia/Jakarta" })
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
      `Login di luar jam operasional (Pukul ${timeString})`
    );
  }
};

const login = async (req, res) => {
  try {
    const { kodeUser, password } = req.body;
    const result = await authService.loginUser(kodeUser, password);

    // [PERBAIKAN UTAMA DISINI]
    // Kita cari object user dimanapun dia berada (di root atau di dalam .data)
    const actualUser = result.user || (result.data && result.data.user);
    const actualCabang = actualUser ? actualUser.cabang : null;

    // Cek token: bisa di root (result.token) atau di data (result.data.token)
    const hasToken = result.token || (result.data && result.data.token);

    if (hasToken && actualUser) {
      checkAndLogSuspiciousLogin(req, actualUser, actualCabang);
    }

    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const selectBranch = async (req, res) => {
  try {
    const { tempToken, selectedCabang } = req.body;

    // Finalize login akan mengembalikan token valid dan data user
    const result = await authService.finalizeLoginWithBranch(
      tempToken,
      selectedCabang
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
};
