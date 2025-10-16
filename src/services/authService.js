const pool = require("../config/database");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const speakeasy = require("speakeasy");
const qrcode = require("qrcode");

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
    [selectedCabang]
  );
  const cabangNama = gudangRows.length > 0 ? gudangRows[0].gdg_nama : "";

  let canApproveCorrection = false;
  let canApprovePrice = false;

  if (user.user_kode === "DARUL") {
    canApproveCorrection = true;
    canApprovePrice = true;
  }

  const userForToken = {
    kode: user.user_kode,
    nama: user.user_nama,
    cabang: selectedCabang,
    cabangNama: cabangNama,
    canApproveCorrection: canApproveCorrection,
    canApprovePrice: canApprovePrice,
  };
  const token = jwt.sign(userForToken, process.env.JWT_SECRET, {
    expiresIn: "8h",
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
    "SELECT * FROM tuser WHERE user_kode = ? AND user_password = ?",
    [kodeUser, password]
  );

  if (users.length === 0) {
    throw new Error("User atau password salah.");
  }

  const firstUser = users[0];
  if (firstUser.user_aktif === 1) {
    throw new Error("User ini sudah tidak aktif.");
  }

  // 2. Cek jumlah cabang
  if (users.length > 1) {
    // User punya banyak cabang, minta frontend untuk memilih
    const branchCodes = users.map((user) => user.user_cab);
    const [gudangRows] = await pool.query(
      "SELECT gdg_kode, gdg_nama FROM tgudang WHERE gdg_kode IN (?)",
      [branchCodes]
    );

    const branchMap = new Map(gudangRows.map((g) => [g.gdg_kode, g.gdg_nama]));
    const detailedBranches = users.map((user) => ({
      kode: user.user_cab,
      nama: branchMap.get(user.user_cab) || user.user_cab,
    }));

    // Buat token temporer
    const tempToken = jwt.sign(
      { kode: kodeUser, password },
      process.env.JWT_SECRET,
      { expiresIn: "5m" }
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
      firstUser.user_cab
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
    [kode, password, selectedCabang]
  );

  if (userRows.length === 0) {
    throw new Error("Gagal memvalidasi user dengan cabang yang dipilih.");
  }
  const user = userRows[0];

  // 3. Buat payload final
  return await generateFinalPayload(user, selectedCabang);
};

module.exports = {
  loginUser,
  finalizeLoginWithBranch,
};
