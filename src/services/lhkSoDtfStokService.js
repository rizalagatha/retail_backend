const pool = require('../config/database');

const getList = async (filters) => {
    const { startDate, endDate, cabang } = filters;
    if (!startDate || !endDate || !cabang) return [];

    const query = `
        SELECT 
            h.ds_nomor AS Nomor,
            h.ds_tanggal AS Tanggal,
            h.ds_sd_nomor AS NoSOdtf,
            IFNULL((SELECT SUM(dd.dsd_jumlah) FROM tdtfstok_dtl dd WHERE dd.dsd_nomor = h.ds_nomor), 0) AS Jumlah,
            h.date_create AS Created,
            h.user_create AS Usr
        FROM tdtfstok_hdr h
        WHERE h.ds_cab = ?
          AND h.ds_tanggal BETWEEN ? AND ?
        ORDER BY h.ds_nomor
    `;
    const [rows] = await pool.query(query, [cabang, startDate, endDate]);
    return rows;
};

const getDetails = async (nomor) => {
    const query = `
        SELECT 
            d.dsd_kode AS Kode,
            a.brg_warna AS Nama,
            d.dsd_ukuran AS Ukuran,
            d.dsd_jumlah AS Jumlah
        FROM tdtfstok_dtl d
        JOIN tdtfstok_hdr h ON d.dsd_nomor = h.ds_nomor
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.dsd_kode
        WHERE d.dsd_nomor = ?
        ORDER BY d.dsd_kode, d.dsd_ukuran
    `;
    const [rows] = await pool.query(query, [nomor]);
    return rows;
};

const getCabangList = async (user) => {
    let query;
    if (user.cabang === 'KDC') {
        query = `SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode NOT IN ("KBS","KPS") ORDER BY gdg_kode`;
    } else {
        query = `SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode = ?`;
    }
    const [rows] = await pool.query(query, [user.cabang]);
    return rows;
};

const remove = async (nomor, user) => {
    // Validasi kepemilikan cabang
    if (user.cabang !== 'KDC' && user.cabang !== nomor.substring(0, 3)) {
        throw new Error(`Anda tidak berhak menghapus data milik cabang ${nomor.substring(0, 3)}.`);
    }
    
    // Di web, kita hapus header dan detail (via ON DELETE CASCADE) dalam satu transaksi
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
        // Asumsi foreign key dari tdtfstok_dtl ke tdtfstok_hdr diset ON DELETE CASCADE
        const [result] = await connection.query('DELETE FROM tdtfstok_hdr WHERE ds_nomor = ?', [nomor]);
        if (result.affectedRows === 0) {
            throw new Error('Data tidak ditemukan atau sudah dihapus.');
        }
        await connection.commit();
        return { message: `LHK Stok ${nomor} berhasil dihapus.` };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = {
    getList,
    getDetails,
    getCabangList,
    remove,
};