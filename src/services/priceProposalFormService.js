const pool = require('../config/database');
const { format } = require('date-fns');

/**
 * Membuat nomor pengajuan harga baru, meniru getnomor dari Delphi.
 * Format: [Cabang].[Tahun].[Nomor Urut 5 digit] -> K02.2024.00001
 */
const generateNewProposalNumber = async (cabang, tanggal) => {
    const year = format(new Date(tanggal), 'yyyy');
    const prefix = `${cabang}.${year}`;
    const query = `
        SELECT IFNULL(MAX(RIGHT(ph_nomor, 5)), 0) as lastNum 
        FROM tpengajuanharga 
        WHERE LEFT(ph_nomor, 8) = ?
    `;
    const [rows] = await pool.query(query, [prefix]);
    const lastNum = parseInt(rows[0].lastNum, 10);
    const newNum = (lastNum + 1).toString().padStart(5, '0');
    return `${prefix}.${newNum}`;
};

/**
 * Mencari jenis kaos untuk F1 help.
 */
const searchTshirtTypes = async (term, custom) => {
    let query = 'SELECT DISTINCT jk_Jenis AS jenisKaos FROM tjeniskaos';
    const params = [];
    
    if (custom === 'Y') {
        query += ' WHERE jk_custom = "Y"';
    } else {
        query += ' WHERE jk_custom = "N"';
    }

    if (term) {
        query += ' AND jk_Jenis LIKE ?';
        params.push(`%${term}%`);
    }
    query += ' ORDER BY jk_Jenis';
    const [rows] = await pool.query(query, params);
    return rows;
};

/**
 * Mengambil daftar ukuran dan harga dasar berdasarkan jenis kaos.
 * Mereplikasi logika dari loadjeniskaos di Delphi.
 */
const getTshirtTypeDetails = async (jenisKaos, custom) => {
    const query = `
        SELECT 
            u.ukuran,
            CASE
                WHEN u.ukuran = "S" THEN k.jk_s
                WHEN u.ukuran = "M" THEN k.jk_m
                WHEN u.ukuran = "L" THEN k.jk_l
                WHEN u.ukuran = "XL" THEN k.jk_xl
                WHEN u.ukuran = "2XL" THEN k.jk_2xl
                WHEN u.ukuran = "3XL" THEN k.jk_3xl
                WHEN u.ukuran = "4XL" THEN k.jk_4xl
                WHEN u.ukuran = "5XL" THEN k.jk_5xl
                ELSE 0
            END AS hargaPcs
        FROM tukuran u
        JOIN tjeniskaos k ON k.jk_Jenis = ? AND k.jk_custom = ?
        WHERE u.kategori = "" AND u.kode >= 2 AND u.kode <= 16
        ORDER BY u.kode;
    `;
    const [rows] = await pool.query(query, [jenisKaos, custom]);
    return rows;
};

const getDiscountByBruto = async (bruto) => {
    if (!bruto || isNaN(parseFloat(bruto))) {
        // Jika bruto tidak valid atau 0, kembalikan diskon 0
        return 0;
    }

    const query = `
        SELECT diskon 
        FROM tpengajuanharga_diskon 
        WHERE ? >= harga1 AND ? <= harga2
    `;
    const [rows] = await pool.query(query, [bruto, bruto]);

    let diskonRp = 0;
    if (rows.length > 0) {
        const diskonPersen = rows[0].diskon;
        diskonRp = (diskonPersen / 100) * parseFloat(bruto);
    }

    return diskonRp;
};

module.exports = {
    generateNewProposalNumber,
    searchTshirtTypes,
    getTshirtTypeDetails,
    getDiscountByBruto,
};
