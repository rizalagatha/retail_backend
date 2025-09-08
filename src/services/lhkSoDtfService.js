const pool = require('../config/database');

const getLhkList = async (filters) => {
    const { startDate, endDate, cabang } = filters;
    if (!startDate || !endDate || !cabang) {
        return []; // Hindari query jika parameter dasar tidak ada
    }

    // Query ini migrasi dari Delphi
    const query = `
        SELECT 
            d.Tanggal,
            d.Cab,
            d.SoDtf,
            h.sd_nama AS NamaDTF,
            d.Depan,
            d.Belakang,
            d.Lengan,
            d.Variasi,
            d.Saku,
            d.panjang AS PanjangMtr,
            d.Buangan AS BuanganMtr,
            d.Keterangan
        FROM tdtf d
        LEFT JOIN retail.tsodtf_hdr h ON h.sd_nomor = d.SoDtf
        WHERE d.tanggal BETWEEN ? AND ?
          AND d.cab = ?
        ORDER BY d.tanggal, d.SoDtf
    `;
    const [rows] = await pool.query(query, [startDate, endDate, cabang]);
    return rows;
};

const getCabangList = async (user) => {
    let query;
    if (user.cabang === 'KDC') {
        // Query untuk KDC tetap sama
        query = 'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode="KDC" OR gdg_dc=0 ORDER BY gdg_kode';
    } else {
        // Query untuk cabang lain tetap sama
        query = 'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?';
    }
    const [rows] = await pool.query(query, [user.cabang]);
    
    // Langsung kembalikan hasilnya tanpa menambahkan "ALL"
    return rows;
};

const remove = async (key, user) => {
    const { Tanggal, SoDtf, Cab } = key;

    // Validasi seperti di Delphi
    if (user.cabang !== '' && user.cabang !== Cab) {
        throw new Error('Data tersebut bukan milik cabang Anda.');
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
        const query = 'DELETE FROM tdtf WHERE Tanggal = ? AND SoDtf = ? AND Cab = ?';
        const [result] = await connection.query(query, [Tanggal, SoDtf, Cab]);

        if (result.affectedRows === 0) {
            throw new Error('Data tidak ditemukan atau sudah dihapus.');
        }

        await connection.commit();
        return { message: 'Data LHK berhasil dihapus.' };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = {
    getLhkList,
    getCabangList,
    remove,
};
