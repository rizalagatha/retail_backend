const pool = require('../config/database');

const getLatestVersion = async () => {
    // FIX: Mengambil data dari tabel tversi di database default (retail)
    const query = `
        SELECT versi 
        FROM tversi 
        WHERE aplikasi = 'RETAIL' 
        LIMIT 1
    `;
    const result = await pool.query(query);
    const rows = Array.isArray(result) ? result[0] : result.rows;
    
    if (rows.length > 0) {
        return rows[0].versi;
    }
    return null;
};

module.exports = { getLatestVersion };
