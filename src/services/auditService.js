const pool = require("../config/database"); // Sesuaikan path database Anda

/**
 * Mencatat Log Audit Trail
 * @param {Object} req - Express Request Object (untuk ambil user, ip, agent)
 * @param {String} action - 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'VOID', 'PRINT'
 * @param {String} module - Nama modul, misal: 'BARANG', 'INVOICE', 'USER'
 * @param {String|Number} targetId - ID dari data yang diubah
 * @param {Object|null} oldData - Data SEBELUM perubahan (Snapshot). Null jika CREATE.
 * @param {Object|null} newData - Data SETELAH perubahan. Null jika DELETE.
 * @param {String|null} note - Catatan tambahan (opsional)
 */
const logActivity = async (
  req,
  action,
  module,
  targetId,
  oldData = null,
  newData = null,
  note = null
) => {
  try {
    // [PERBAIKAN DISINI]
    // Ambil 'kode' dari req.user sebagai user_id.
    // Fallback ke 'id' jika kode tidak ada.
    const userPayload = req.user || {};

    // Kita ambil user.kode (sesuai request) atau user.user_kode
    const userId =
      userPayload.kode || userPayload.user_kode || userPayload.id || null;

    const userNama = userPayload.nama || userPayload.username || "System/Guest";
    const userCabang = userPayload.cabang || null;

    // Ambil Info Device
    const ipAddress = (
      req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress ||
      ""
    )
      .split(",")[0]
      .trim();
    const userAgent = req.headers["user-agent"] || "Unknown";

    const cleanOld = oldData ? JSON.stringify(oldData) : null;
    const cleanNew = newData ? JSON.stringify(newData) : null;

    const query = `
      INSERT INTO taudit_log 
      (user_id, user_nama, user_cabang, ip_address, user_agent, action, module, target_id, old_values, new_values, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    pool
      .query(query, [
        userId, // Sekarang ini berisi Kode User (misal: 'FENITA' atau 'KSR01')
        userNama,
        userCabang,
        ipAddress,
        userAgent,
        action,
        module,
        String(targetId),
        cleanOld,
        cleanNew,
        note,
      ])
      .catch((err) => {
        console.error("🔥 [AUDIT_LOG_ERROR] Gagal mencatat log:", err.message);
      });
  } catch (error) {
    console.error("🔥 [AUDIT_SYSTEM_ERROR]", error);
  }
};

module.exports = { logActivity };
