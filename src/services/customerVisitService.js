const pool = require("../config/database");

const checkVisitToday = async (cabang, customerKode, tanggal) => {
  const query = `
    SELECT id, tipe_kunjungan 
    FROM tkunjungan_customer 
    WHERE cabang = ? AND cus_kode = ? AND tanggal = ?
    LIMIT 1
  `;
  const [rows] = await pool.query(query, [cabang, customerKode, tanggal]);

  return {
    hasVisited: rows.length > 0,
    visitData: rows.length > 0 ? rows[0] : null,
  };
};

module.exports = {
  checkVisitToday,
};
