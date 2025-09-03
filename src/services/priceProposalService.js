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
            LEFT(h.ph_nomor, 3) AS cabang,
            h.user_create AS created
        FROM tpengajuanharga h
        LEFT JOIN tcustomer c ON c.cus_kode = h.ph_kd_cus
        WHERE h.ph_tanggal BETWEEN ? AND ?
    `;

    if (cabang !== 'ALL') {
        query += ' AND LEFT(h.ph_nomor, 3) = ?';
        params.push(cabang);
    }

    if (belumApproval) {
        query += ' AND (h.ph_apv IS NULL OR h.ph_apv = "")';
    }

    query += ' ORDER BY h.ph_tanggal, h.ph_nomor';

    const [rows] = await pool.query(query, params);
    return rows;
};

module.exports = {
    getPriceProposals,
};