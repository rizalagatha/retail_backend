// src/services/userActivityService.js
const pool = require("../config/database");

/**
 * Catat akses menu.
 */
const logMenuAccess = async (userKode, menu) => {
  const { title, path, icon } = menu;

  if (!userKode || !title || !path) return;

  const query = `
    INSERT INTO tuser_menu_log (user_kode, menu_title, menu_path, menu_icon, hit_count, last_accessed)
    VALUES (?, ?, ?, ?, 1, NOW())
    ON DUPLICATE KEY UPDATE 
      hit_count = hit_count + 1,
      last_accessed = NOW();
  `;

  try {
    await pool.query(query, [
      userKode,
      title,
      path,
      icon || "mdi-circle-small",
    ]);
  } catch (error) {
    console.error("Error logging menu access:", error);
    // Silent fail agar tidak mengganggu user
  }
};

/**
 * Ambil menu yang paling sering diakses.
 */
const getFrequentMenus = async (userKode, limit = 6) => {
  const query = `
    SELECT 
        menu_title AS title, 
        menu_path AS \`to\`, 
        menu_icon AS icon,
        hit_count
    FROM tuser_menu_log
    WHERE user_kode = ?
    ORDER BY hit_count DESC, last_accessed DESC
    LIMIT ?
  `;

  const [rows] = await pool.query(query, [userKode, limit]);
  return rows;
};

module.exports = {
  logMenuAccess,
  getFrequentMenus,
};
