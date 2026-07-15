const pool = require("../config/database");
const { format } = require("date-fns");

// Judul otomatis dari pertanyaan pertama user — dipotong biar rapi di list
const generateTitle = (text) => {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= 50) return clean || "Percakapan baru";
  return clean.slice(0, 50) + "...";
};

// Buat sesi baru, judul diambil dari pesan pertama user
const createSession = async (userKode, firstMessageContent) => {
  const now = format(new Date(), "yyyy-MM-dd HH:mm:ss");
  const judul = generateTitle(firstMessageContent);
  const [result] = await pool.query(
    `INSERT INTO ai_chat_sessions (user_kode, judul, date_create, date_update)
     VALUES (?, ?, ?, ?)`,
    [userKode, judul, now, now],
  );
  return result.insertId;
};

// Simpan 1 pesan (user atau assistant) ke sesi, sekalian update timestamp
// sesi supaya urutan "terbaru" di list selalu akurat.
const saveMessage = async (sessionId, role, content) => {
  const now = format(new Date(), "yyyy-MM-dd HH:mm:ss");
  await pool.query(
    `INSERT INTO ai_chat_messages (session_id, role, content, date_create)
     VALUES (?, ?, ?, ?)`,
    [sessionId, role, content, now],
  );
  await pool.query(`UPDATE ai_chat_sessions SET date_update = ? WHERE id = ?`, [
    now,
    sessionId,
  ]);
};

// List sesi milik user, terbaru duluan — untuk sidebar "Recent Chats"
const listSessions = async (userKode, limit = 20) => {
  const [rows] = await pool.query(
    `SELECT id, judul, date_create, date_update
     FROM ai_chat_sessions
     WHERE user_kode = ?
     ORDER BY date_update DESC
     LIMIT ?`,
    [userKode, limit],
  );
  return rows;
};

// Ambil semua pesan dalam 1 sesi — validasi kepemilikan (user_kode harus cocok)
// supaya user A tidak bisa baca histori chat user B lewat tebak-tebak ID.
const getSessionMessages = async (sessionId, userKode) => {
  const [sessionRows] = await pool.query(
    `SELECT id FROM ai_chat_sessions WHERE id = ? AND user_kode = ?`,
    [sessionId, userKode],
  );
  if (sessionRows.length === 0) {
    throw new Error("Sesi chat tidak ditemukan atau bukan milik Anda.");
  }

  const [rows] = await pool.query(
    `SELECT role, content, date_create
     FROM ai_chat_messages
     WHERE session_id = ?
     ORDER BY date_create ASC, id ASC`,
    [sessionId],
  );
  return rows;
};

// Hapus sesi (dan otomatis semua pesannya, via ON DELETE CASCADE)
const deleteSession = async (sessionId, userKode) => {
  const [result] = await pool.query(
    `DELETE FROM ai_chat_sessions WHERE id = ? AND user_kode = ?`,
    [sessionId, userKode],
  );
  if (result.affectedRows === 0) {
    throw new Error("Sesi chat tidak ditemukan atau bukan milik Anda.");
  }
};

module.exports = {
  createSession,
  saveMessage,
  listSessions,
  getSessionMessages,
  deleteSession,
};
