const pool = require('../config/database');

const searchWarehouses = async (term, userCabang, page, itemsPerPage) => {
    const offset = (page - 1) * itemsPerPage;
    const searchTerm = `%${term}%`;
    let params = [];
    
    // Meniru logika if frmMenu.CABKAOS='KDC' dari Delphi
    let branchFilter = '';
    if (userCabang === 'KDC') {
        branchFilter = 'WHERE gdg_dc = 1';
    } else {
        branchFilter = 'WHERE gdg_kode = ?';
        params.push(userCabang);
    }

    let searchFilter = '';
    if (term) {
        searchFilter = ` AND (gdg_kode LIKE ? OR gdg_nama LIKE ?)`;
        params.push(searchTerm, searchTerm);
    }
    
    const baseQuery = `FROM tgudang ${branchFilter} ${searchFilter}`;

    // Query untuk menghitung total
    const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;
    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0].total;

    // Query untuk mengambil data per halaman
    const dataQuery = `
        SELECT gdg_kode AS kode, gdg_nama AS nama 
        ${baseQuery}
        ORDER BY gdg_kode
        LIMIT ? OFFSET ?
    `;
    const [items] = await pool.query(dataQuery, [...params, itemsPerPage, offset]);

    return { items, total };
};

const getBranchOptions = async (userCabang) => {
    let query = '';
    let params = [];

    // Meniru logika filter dari Delphi
    if (userCabang === 'KDC') {
        // Jika user adalah KDC, tampilkan semua gudang kecuali KBS dan KPS
        query = 'SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode NOT IN ("KBS", "KPS") ORDER BY gdg_kode';
    } else {
        // Jika bukan KDC, hanya tampilkan gudang milik user itu sendiri
        query = 'SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode = ?';
        params.push(userCabang);
    }
    const [rows] = await pool.query(query, params);
    return rows;
};

const getSoDtfBranchOptions = async (userCabang) => {
    let query = '';
    let params = [];

    // Meniru logika dari FormCreate di UBrowseSoDTF.pas
    if (userCabang === 'KDC') {
        // Jika user adalah KDC, tampilkan semua cabang store (gdg_dc = 0)
        query = 'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc = 0 ORDER BY gdg_kode';
    } else {
        // Jika bukan KDC, hanya tampilkan cabang milik user itu sendiri
        query = 'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?';
        params.push(userCabang);
    }
    const [rows] = await pool.query(query, params);
    return rows;
};

module.exports = {
    searchWarehouses,
    getBranchOptions,
    getSoDtfBranchOptions,
};
