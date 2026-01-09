const pool = require('../config/database');
const { format, addDays, parseISO } = require('date-fns');

/**
 * Mengambil daftar header Master Barang External.
 * Menerjemahkan TfrmBrowBarangExt.btnRefreshClick (SQLMaster)
 */
const getList = async (filters, user) => {
    const { startDate, endDate } = filters;
    
    // Tambahkan 1 hari ke endDate untuk mencakup keseluruhan hari (logika Delphi: date_create <= endDate+1)
    const inclusiveEndDate = format(addDays(parseISO(endDate), 1), 'yyyy-MM-dd');
    
    const query = `
        SELECT 
            a.brg_kode AS kode,
            a.brg_ktgp AS KtgProduk,
            a.brg_ktg AS KtgBarang,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            a.Date_Create AS date_create,
            IF(a.brg_otomatis = 1, "YA", "") AS otomatis,
            a.brg_logstok AS adaStok,
            IF(a.brg_aktif = 0, "AKTIF", "PASIF") AS status
        FROM tbarangdc a
        WHERE a.brg_ktg <> "" 
          AND a.date_create >= ? 
          AND a.date_create < ?
        ORDER BY a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna
    `;
    const params = [startDate, inclusiveEndDate];
    
    const [rows] = await pool.query(query, params);
    return rows;
};

/**
 * Mengambil data detail untuk baris master.
 * Menerjemahkan TfrmBrowBarangExt.btnRefreshClick (SQLDetail)
 */
const getDetails = async (nomor, user) => {
    let query = `
        SELECT 
            b.brgd_kode AS kode,
            b.brgd_ukuran AS ukuran,
            b.brgd_barcode AS barcode,
            b.brgd_harga AS harga
    `;
    
    // Tambahkan HPP jika user KDC
    if (user.cabang === 'KDC') {
        query += ', b.brgd_hpp AS hpp';
    }
    
    query += `
        FROM tbarangdc_dtl b
        LEFT JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
        WHERE a.brg_ktg <> "" AND b.brgd_kode = ?
        ORDER BY b.brgd_kode, b.brgd_ukuran
    `;
    
    const [rows] = await pool.query(query, [nomor]);
    return rows;
};

/**
 * Mengambil data detail untuk export.
 */
const getExportDetails = async (filters, user) => {
    const { startDate, endDate } = filters;
    const inclusiveEndDate = format(addDays(parseISO(endDate), 1), 'yyyy-MM-dd');

    let query = `
        SELECT 
            b.brgd_kode AS 'Kode Barang',
            a.brg_ktgp AS 'Kategori Produk',
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS 'Nama Barang',
            b.brgd_ukuran AS 'Ukuran',
            b.brgd_barcode AS 'Barcode',
            b.brgd_harga AS 'Harga'
    `;
    
    if (user.cabang === 'KDC') {
        query += ", b.brgd_hpp AS 'HPP'";
    }
    
    query += `
        FROM tbarangdc_dtl b
        LEFT JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
        WHERE a.brg_ktg <> ""
          AND a.date_create >= ? 
          AND a.date_create < ?
        ORDER BY b.brgd_kode, b.brgd_ukuran
    `;
    const params = [startDate, inclusiveEndDate];
    
    const [rows] = await pool.query(query, params);
    return rows;
};

module.exports = {
    getList,
    getDetails,
    getExportDetails,
};