const pool = require('../config/database');

const getAllSalesCounters = async () => {
    const query = `
        SELECT 
            sc_kode AS kode,
            sc_nama AS nama,
            sc_alamat AS alamat,
            sc_hp AS hp,
            sc_ktp AS ktp,
            IF(sc_aktif = 'Y', 'AKTIF', 'PASIF') AS status
        FROM tsalescounter 
        ORDER BY sc_nama;
    `;
    const [rows] = await pool.query(query);
    return rows;
};

const saveSalesCounter = async (data) => {
    const { isNew, kode, nama, alamat, hp, ktp, status } = data;
    const scAktif = status === 'AKTIF' ? 'Y' : 'N';

    if (isNew) {
        await pool.query(
            'INSERT INTO tsalescounter (sc_kode, sc_nama, sc_alamat, sc_hp, sc_ktp, sc_aktif) VALUES (?, ?, ?, ?, ?, ?)',
            [kode, nama, alamat, hp, ktp, scAktif]
        );
    } else {
        await pool.query(
            'UPDATE tsalescounter SET sc_nama = ?, sc_alamat = ?, sc_hp = ?, sc_ktp = ?, sc_aktif = ? WHERE sc_kode = ?',
            [nama, alamat, hp, ktp, scAktif, kode]
        );
    }
    return { success: true, message: 'Data sales counter berhasil disimpan.' };
};

const deleteSalesCounter = async (kode) => {
    await pool.query('DELETE FROM tsalescounter WHERE sc_kode = ?', [kode]);
    return { success: true, message: 'Data sales counter berhasil dihapus.' };
};

module.exports = {
    getAllSalesCounters,
    saveSalesCounter,
    deleteSalesCounter,
};