const pool = require('../config/database');

/**
 * Mengambil daftar pengajuan harga berdasarkan filter.
 * Mereplikasi query dari TfrmBrowPengajuanHarga.btnRefreshClick.
 */
const getPriceProposals = async (filters) => {
    const { startDate, endDate, cabang, belumApproval } = filters;
    let params = [startDate, endDate];

    let query = `
        SELECT 
            h.ph_nomor AS nomor,
            h.ph_tanggal AS tanggal,
            h.ph_kd_cus AS kdcus,
            c.cus_nama AS customer,
            h.ph_jenis AS jenisKaos,
            h.ph_ket AS keterangan,
            h.ph_apv AS approval,
            h.ph_cab AS cabang,
            h.user_create AS created
        FROM tpengajuanharga h
        LEFT JOIN tcustomer c ON c.cus_kode = h.ph_kd_cus
        WHERE h.ph_tanggal BETWEEN ? AND ?
    `;

    if (cabang !== 'ALL') {
        query += ' AND h.ph_cab = ?';
        params.push(cabang);
    }

    if (belumApproval) {
        query += ' AND (h.ph_apv IS NULL OR h.ph_apv = "")';
    }

    query += ' ORDER BY h.ph_tanggal, h.ph_nomor';

    const [rows] = await pool.query(query, params);
    return rows;
};

const getProposalDetails = async (nomor) => {
    const query = `SELECT * FROM tpengajuanharga WHERE ph_nomor = ?`;
    const [rows] = await pool.query(query, [nomor]);
    if (rows.length === 0) {
        throw new Error('Data tidak ditemukan');
    }
    return rows[0];
};

const deleteProposal = async (nomor) => {
    // Di aplikasi nyata, Anda harus menggunakan transaksi di sini
    // untuk menghapus data dari semua tabel terkait (sizes, bordir, dtf, dll.)
    
    // Hapus dari tabel header
    const query = `DELETE FROM tpengajuanharga WHERE ph_nomor = ?`;
    const [result] = await pool.query(query, [nomor]);

    if (result.affectedRows === 0) {
        throw new Error('Gagal menghapus data, nomor tidak ditemukan.');
    }
    return { message: 'Pengajuan harga berhasil dihapus.' };
};

module.exports = {
    getPriceProposals,
    getProposalDetails,
    deleteProposal,
};