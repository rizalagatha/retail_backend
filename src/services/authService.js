const pool = require("../config/database");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const speakeasy = require("speakeasy");
const qrcode = require("qrcode");
const { differenceInDays } = require("date-fns");

/**
 * Mengambil hak akses (permissions) untuk seorang user.
 * @param {string} userKode - Kode user.
 * @returns {Promise<Array>}
 */
const getPermissions = async (userKode) => {
  const query = `
    SELECT 
      m.men_id AS id,
      m.men_nama AS name,
      m.web_route AS path,
      h.hak_men_view AS 'view',
      h.hak_men_insert AS 'insert',
      h.hak_men_edit AS 'edit',
      h.hak_men_delete AS 'delete'
    FROM thakuser h
    JOIN tmenu m ON h.hak_men_id = m.men_id
    WHERE h.hak_user_kode = ? AND m.web_route IS NOT NULL AND m.web_route <> '';
  `;
  const [permissions] = await pool.query(query, [userKode]);
  return permissions.map((p) => ({
    ...p,
    view: p.view === "Y",
    insert: p.insert === "Y",
    edit: p.edit === "Y",
    delete: p.delete === "Y",
  }));
};

const GUEST_KODE = "GUEST";
const GUEST_WORK_START_HOUR = 8; // 08:00
const GUEST_WORK_END_HOUR = 16; // 16:00

// Detik tersisa dari sekarang sampai jam 16:00 di hari yang sama.
// Dipakai sebagai masa berlaku token GUEST, supaya sesi otomatis
// mati tepat di akhir jam kerja walau login-nya jam 08:00 pagi.
const getSecondsUntilGuestCutoff = () => {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setHours(GUEST_WORK_END_HOUR, 0, 0, 0);
  return Math.max(60, Math.floor((cutoff - now) / 1000)); // minimal 60 detik
};

/**
 * Membuat payload final untuk login (token, user, permissions).
 * @param {object} user - Objek data user dari database.
 * @param {string} selectedCabang - Kode cabang yang dipilih.
 * @returns {Promise<object>}
 */
const generateFinalPayload = async (user, selectedCabang) => {
  const [gudangRows] = await pool.query(
    "SELECT gdg_nama FROM tgudang WHERE gdg_kode = ?",
    [selectedCabang],
  );
  const cabangNama = gudangRows.length > 0 ? gudangRows[0].gdg_nama : "";

  // [LOGIC BARU] Daftar User Gudang (Hanya lihat stok)
  const warehouseUsers = ["LUTFI", "ADIN"];
  const userKodeUpper = user.user_kode.toUpperCase();
  const isWarehouseUser = warehouseUsers.includes(userKodeUpper);

  // [LOGIC BARU] Daftar User Finance
  const financeUsers = ["DARUL", "LIA", "HANI", "DEVI"];
  // Cek apakah user termasuk Finance
  const isFinance = financeUsers.includes(userKodeUpper);

  const userForToken = {
    kode: user.user_kode,
    nama: user.user_nama,
    cabang: selectedCabang,
    cabangNama: cabangNama,
    isWarehouseUser: isWarehouseUser,
    // Flag khusus Refund
    canApproveRefund: isFinance,
    // Flag existing Anda
    canApproveCorrection: isFinance,
    canApprovePrice: isFinance,
  };

  // --- LOGIKA EXPIRATION TOKEN KHUSUS ---
  // SETYO: masa aktif 1 tahun.
  // GUEST: token dipotong pas jam 16:00 hari ini, berapa pun sisa
  //        jam kerja saat dia login — bukan durasi tetap.
  // User lainnya: standar 12 jam.
  let tokenExpiry;
  if (userKodeUpper === "SETYO") {
    tokenExpiry = "365d";
  } else if (userKodeUpper === GUEST_KODE) {
    tokenExpiry = getSecondsUntilGuestCutoff();
  } else {
    tokenExpiry = "12h";
  }

  const token = jwt.sign(userForToken, process.env.JWT_SECRET, {
    expiresIn: tokenExpiry,
  });

  const permissions = await getPermissions(user.user_kode);

  return {
    message: "Login berhasil",
    token,
    user: userForToken,
    permissions,
  };
};

/**
 * Memproses percobaan login awal.
 * @param {string} kodeUser - Kode user yang login.
 * @param {string} password - Password user.
 * @returns {Promise<object>}
 */
const loginUser = async (kodeUser, password) => {
  // 1. Verifikasi user dan password
  const [users] = await pool.query(
    "SELECT * FROM tuser WHERE user_kode = ? AND BINARY user_password = ?",
    [kodeUser, password],
  );

  if (users.length === 0) {
    throw new Error("User atau password salah.");
  }

  const firstUser = users[0];
  if (firstUser.user_aktif === 1) {
    throw new Error("User ini sudah tidak aktif.");
  }

  const isGuest = kodeUser.toUpperCase() === GUEST_KODE;

  // --- [LOGIC BARU: GUEST HANYA BOLEH LOGIN JAM 08:00–16:00] ---
  if (isGuest) {
    const currentHour = new Date().getHours();
    if (
      currentHour < GUEST_WORK_START_HOUR ||
      currentHour >= GUEST_WORK_END_HOUR
    ) {
      throw new Error(
        `Akun GUEST hanya bisa login pada jam kerja (${String(GUEST_WORK_START_HOUR).padStart(2, "0")}:00 - ${String(GUEST_WORK_END_HOUR).padStart(2, "0")}:00).`,
      );
    }
  }
  // --- [AKHIR LOGIC BARU] ---

  // --- [LOGIC BARU: CEK USIA PASSWORD] ---
  // GUEST dikecualikan — masa aktifnya sudah dibatasi jam kerja di atas.
  if (!isGuest) {
    const lastUpdate = firstUser.user_pass_last_update || firstUser.date_create;
    const daysSinceUpdate = differenceInDays(new Date(), new Date(lastUpdate));

    // Jika lebih dari 90 hari (3 bulan), interupsi login
    if (daysSinceUpdate >= 90) {
      const tempToken = jwt.sign(
        { kode: kodeUser, isChangingPassword: true },
        process.env.JWT_SECRET,
        { expiresIn: "10m" },
      );

      return {
        requiresPasswordChange: true,
        message:
          "Password Anda sudah lebih dari 3 bulan. Harap perbarui password Anda.",
        tempToken,
      };
    }
  }
  // --- [AKHIR LOGIC BARU] ---

  // 2. Cek jumlah cabang
  if (users.length > 1) {
    const branchCodes = users.map((user) => user.user_cab);
    const [gudangRows] = await pool.query(
      "SELECT gdg_kode, gdg_nama FROM tgudang WHERE gdg_kode IN (?)",
      [branchCodes],
    );

    const branchMap = new Map(gudangRows.map((g) => [g.gdg_kode, g.gdg_nama]));
    const detailedBranches = users.map((user) => ({
      kode: user.user_cab,
      nama: branchMap.get(user.user_cab) || user.user_cab,
    }));

    // --- LOGIC PRIORITAS CABANG ---
    const priorityUsers = ["LUTFI", "ADIN"];
    const userUpper = kodeUser.toUpperCase();

    if (priorityUsers.includes(userUpper)) {
      detailedBranches.sort((a, b) => {
        const isAPriority =
          a.kode === "KDC" || a.nama.toUpperCase().includes("DC PUSAT");
        const isBPriority =
          b.kode === "KDC" || b.nama.toUpperCase().includes("DC PUSAT");

        if (isAPriority && !isBPriority) return -1;
        if (!isAPriority && isBPriority) return 1;
        return 0;
      });
    }
    // ------------------------------------------

    const tempToken = jwt.sign(
      { kode: kodeUser, password },
      process.env.JWT_SECRET,
      { expiresIn: "5m" },
    );

    return {
      requiresBranchSelection: true,
      branches: detailedBranches,
      tempToken,
    };
  } else {
    const finalPayload = await generateFinalPayload(
      firstUser,
      firstUser.user_cab,
    );
    return {
      requiresBranchSelection: false,
      data: finalPayload,
    };
  }
};

/**
 * Menyelesaikan proses login setelah user memilih cabang.
 * @param {string} tempToken - Token temporer dari percobaan login awal.
 * @param {string} selectedCabang - Kode cabang yang dipilih.
 * @returns {Promise<object>}
 */
const finalizeLoginWithBranch = async (tempToken, selectedCabang) => {
  // 1. Verifikasi token temporer
  let decoded;
  try {
    decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
  } catch (error) {
    throw new Error("Sesi pemilihan cabang sudah habis, silahkan login ulang.");
  }

  const { kode, password } = decoded;

  // 2. Ambil data user spesifik untuk cabang yang dipilih
  const [userRows] = await pool.query(
    "SELECT * FROM tuser WHERE user_kode = ? AND user_password = ? AND user_cab = ?",
    [kode, password, selectedCabang],
  );

  if (userRows.length === 0) {
    throw new Error("Gagal memvalidasi user dengan cabang yang dipilih.");
  }
  const user = userRows[0];

  // 3. Buat payload final
  return await generateFinalPayload(user, selectedCabang);
};

/**
 * Service untuk update password dengan validasi Case-Insensitive
 */
const updateExpiredPassword = async (kodeUser, newPassword) => {
  const cleanNewPassword = String(newPassword || "").trim();

  if (cleanNewPassword.length < 4) {
    throw new Error("Password baru minimal 4 karakter.");
  }

  // 1. Ambil password saat ini
  const [currentRows] = await pool.query(
    "SELECT user_password FROM tuser WHERE user_kode = ? LIMIT 1",
    [kodeUser],
  );

  if (currentRows.length > 0) {
    const oldPassword = String(currentRows[0].user_password || "").trim();

    // 2. Validasi Case-Insensitive: Ubah keduanya ke huruf kecil saat dibanding
    if (cleanNewPassword.toLowerCase() === oldPassword.toLowerCase()) {
      throw new Error(
        "Password baru tidak boleh sama dengan password lama (meskipun beda huruf besar/kecil).",
      );
    }
  }

  // 3. Simpan password baru (Tetap pertahankan casing asli saat menyimpan ke DB)
  const query = `
    UPDATE tuser 
    SET user_password = ?, user_pass_last_update = NOW() 
    WHERE user_kode = ?
  `;

  await pool.query(query, [cleanNewPassword, kodeUser]);

  return { message: "Password berhasil diperbarui. Silakan login kembali." };
};

module.exports = {
  loginUser,
  finalizeLoginWithBranch,
  updateExpiredPassword,
};
