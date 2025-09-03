const pool = require('../config/database');

/**
 * Mengambil data history update program dari database.
 * @param {number} limit - Jumlah versi rilis terakhir yang akan diambil.
 * @returns {Promise<Array>} Array berisi data history.
 */
const getHistory = async (limit = 10) => {
    const numericLimit = parseInt(limit, 10);

    // Query 1: Mengambil daftar versi unik terakhir (sama seperti query pertama di Delphi)
    const versionQuery = `
        SELECT DISTINCT r_versi 
        FROM pengaturan.trelease_retail 
        WHERE r_tanggal IS NOT NULL 
        ORDER BY r_versi DESC 
        LIMIT ?
    `;
    
    const versionResult = await pool.query(versionQuery, [numericLimit]);
    const versions = Array.isArray(versionResult) ? versionResult[0] : versionResult.rows;

    if (versions.length === 0) {
        return [];
    }

    // Mengambil hanya nilai versinya saja untuk digunakan di query berikutnya
    const versionList = versions.map(v => v.r_versi);

    // Query 2: Mengambil semua detail rilis untuk versi-versi yang ditemukan
    // FIX: Menghapus kolom 'r_id' dari SELECT dan ORDER BY
    const detailsQuery = `
        SELECT 
            r_versi, 
            r_ket, 
            DATE_FORMAT(r_tanggal, '%d-%m-%Y') as tgl
        FROM 
            pengaturan.trelease_retail
        WHERE 
            r_versi IN (?)
        ORDER BY 
            r_versi DESC;
    `;

    const detailsResult = await pool.query(detailsQuery, [versionList]);
    const rows = Array.isArray(detailsResult) ? detailsResult[0] : detailsResult.rows;
    
    return rows;
};

module.exports = {
    getHistory,
};
