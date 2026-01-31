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
  // Jika user adalah SETYO, berikan masa aktif 30 hari ('30d').
  // User lainnya tetap menggunakan standar 12 jam ('12h').
  const tokenExpiry = userKodeUpper === "SETYO" ? "30d" : "12h";

  const token = jwt.sign(userForToken, process.env.JWT_SECRET, {
    expiresIn: tokenExpiry, // Menggunakan variabel dinamis
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

  // --- [LOGIC BARU: CEK USIA PASSWORD] ---
  const lastUpdate = firstUser.user_pass_last_update || firstUser.date_create;
  const daysSinceUpdate = differenceInDays(new Date(), new Date(lastUpdate));

  // Jika lebih dari 90 hari (3 bulan), interupsi login
  if (daysSinceUpdate >= 90) {
    const tempToken = jwt.sign(
      { kode: kodeUser, isChangingPassword: true },
      process.env.JWT_SECRET,
      { expiresIn: "10m" }, // Token pendek khusus ganti password
    );

    return {
      requiresPasswordChange: true,
      message:
        "Password Anda sudah lebih dari 3 bulan. Harap perbarui password Anda.",
      tempToken,
    };
  }
  // --- [AKHIR LOGIC BARU] ---

  // 2. Cek jumlah cabang
  if (users.length > 1) {
    // User punya banyak cabang, minta frontend untuk memilih
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
        // Tentukan kriteria prioritas (KDC atau Nama mengandung DC PUSAT)
        const isAPriority =
          a.kode === "KDC" || a.nama.toUpperCase().includes("DC PUSAT");
        const isBPriority =
          b.kode === "KDC" || b.nama.toUpperCase().includes("DC PUSAT");

        // Geser ke atas jika memenuhi kriteria
        if (isAPriority && !isBPriority) return -1;
        if (!isAPriority && isBPriority) return 1;
        return 0;
      });
    }
    // ------------------------------------------

    // Buat token temporer
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
    // User hanya punya satu cabang, langsung login
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
