const pool = require('../config/database');

// Mengambil daftar data (SQLMaster)
const getList = async (filters) => {
    const { startDate, endDate, cabang, filterDateType } = filters;
    const dateColumn = filterDateType === 'pengerjaan' ? 'h.sd_datekerja' : 'h.sd_tanggal';
    
    const query = `
        SELECT 
            h.sd_nomor AS Nomor, 
            h.sd_tanggal AS Tanggal, 
            h.sd_datekerja AS TglPengerjaan, 
            h.sd_nama AS NamaDTF,
            IFNULL((SELECT SUM(i.sds_jumlah) FROM tsodtf_stok i WHERE i.sds_nomor = h.sd_nomor), 0) AS Jumlah,
            IFNULL((SELECT SUM(i.dsd_jumlah) FROM tdtfstok_dtl i JOIN tdtfstok_hdr j ON j.ds_nomor = i.dsd_nomor WHERE j.ds_sd_nomor = h.sd_nomor), 0) AS LHK,
            s.sal_nama AS Sales, 
            h.sd_desain AS BagDesain, 
            h.sd_Workshop AS Workshop, 
            h.sd_kain AS Kain, 
            h.sd_finishing AS Finishing, 
            h.sd_ket AS Keterangan,
            h.sd_alasan AS AlasanClose, 
            h.date_create AS Created, 
            h.sd_closing AS Close
        FROM tsodtf_hdr h
        LEFT JOIN kencanaprint.tsales s ON s.sal_kode = h.sd_sal_kode
        WHERE h.sd_stok = "Y" 
          AND LEFT(h.sd_nomor, 3) = ?
          AND ${dateColumn} BETWEEN ? AND ?
        ORDER BY ${dateColumn}, h.sd_nomor
    `;
    const [rows] = await pool.query(query, [cabang, startDate, endDate]);
    return rows;
};

// Mengambil data detail (SQLDetail)
const getDetails = async (nomor, filters) => {
    // Ambil filter yang relevan dari frontend
    const { startDate, endDate, cabang, filterDateType } = filters;
    const dateColumn = filterDateType === 'pengerjaan' ? 'h.sd_datekerja' : 'h.sd_tanggal';

    // Query ini sekarang menyertakan semua filter yang diperlukan
    const query = `
        SELECT 
            d.sds_kode AS Kode,
            a.brg_warna AS Nama,
            d.sds_ukuran AS Ukuran,
            d.sds_jumlah AS Jumlah,
            IFNULL((
                SELECT SUM(dd.dsd_jumlah) 
                FROM tdtfstok_dtl dd 
                JOIN tdtfstok_hdr hh ON hh.ds_nomor = dd.dsd_nomor 
                WHERE hh.ds_sd_nomor = h.sd_nomor AND dd.dsd_kode = d.sds_kode AND dd.dsd_ukuran = d.sds_ukuran
            ), 0) AS LHK,
            (d.sds_jumlah - IFNULL((
                SELECT SUM(dd.dsd_jumlah) 
                FROM tdtfstok_dtl dd 
                JOIN tdtfstok_hdr hh ON hh.ds_nomor = dd.dsd_nomor 
                WHERE hh.ds_sd_nomor = h.sd_nomor AND dd.dsd_kode = d.sds_kode AND dd.dsd_ukuran = d.sds_ukuran
            ), 0)) AS Kurang
        FROM tsodtf_stok d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.sds_kode
        JOIN tsodtf_hdr h ON h.sd_nomor = d.sds_nomor
        WHERE d.sds_nomor = ? 
          AND LEFT(h.sd_nomor, 3) = ?
          AND ${dateColumn} BETWEEN ? AND ?
        ORDER BY d.sds_nourut
    `;
    const [rows] = await pool.query(query, [nomor, cabang, startDate, endDate]);
    return rows;
};

// Mengambil daftar cabang
const getCabangList = async (user) => {
    let query;
    if (user.cabang === 'KDC') {
        query = 'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc=0 ORDER BY gdg_kode';
    } else {
        query = 'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?';
    }
    const [rows] = await pool.query(query, [user.cabang]);
    return rows;
};

// Menutup SO
const close = async (data) => {
    const { nomor, alasan, user } = data;
    const query = `UPDATE tsodtf_hdr SET sd_alasan = ?, sd_closing = 'Y', user_modified = ?, date_modified = NOW() WHERE sd_nomor = ?`;
    const [result] = await pool.query(query, [alasan, user, nomor]);
    if (result.affectedRows === 0) throw new Error('Gagal menutup SO, nomor tidak ditemukan.');
    return { message: 'SO berhasil ditutup.' };
};

// Menghapus SO
const remove = async (nomor, user) => {
    // Implementasi logika hapus dengan validasi
    // ...
    return { message: `SO ${nomor} berhasil dihapus.` };
};

module.exports = {
    getList,
    getDetails,
    getCabangList,
    close,
    remove,
};
