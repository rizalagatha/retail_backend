const pool = require('../config/database');

const getList = async (filters) => {
    const { startDate, endDate, cabang } = filters;
    if (!startDate || !endDate || !cabang) return [];

    // Query ini telah dilengkapi dengan semua kolom yang Anda minta
    const query = `
        SELECT 
            x.Nomor, x.Tanggal, x.NoSO, x.NoSJ, x.TerimaSJ, x.KeCab, x.KdCus, x.Customer,
            x.QtyOut, x.QtyIn, x.Otomatis, x.Closing,
            IF(x.QtyIn >= x.QtyOut, "CLOSE", IF(x.QtyIn > 0 AND x.QtyIn < x.QtyOut, "PROSES", "OPEN")) AS Status,
            x.Keterangan, x.Usr
        FROM (
            SELECT 
                h.mo_nomor AS Nomor,
                h.mo_tanggal AS Tanggal,
                h.mo_so_nomor AS NoSO,
                h.mo_sj_nomor AS NoSJ,
                h.mo_tglterima_sj AS TerimaSJ,
                h.mo_kecab AS KeCab,
                h.mo_otomatis AS Otomatis,
                h.mo_closing AS Closing,
                IFNULL((SELECT SUM(dd.mod_jumlah) FROM tmutasiout_dtl dd WHERE dd.mod_nomor = h.mo_nomor), 0) AS QtyOut,
                IFNULL((SELECT SUM(dd.mid_jumlah) FROM tmutasiin_dtl dd JOIN tmutasiin_hdr hh ON hh.mi_nomor = dd.mid_nomor WHERE hh.mi_mo_nomor = h.mo_nomor), 0) AS QtyIn,
                h.mo_ket AS Keterangan,
                h.user_create AS Usr,
                so.so_cus_kode AS KdCus,
                cus.cus_nama AS Customer
            FROM tmutasiout_hdr h
            LEFT JOIN tso_hdr so ON so.so_nomor = h.mo_so_nomor
            LEFT JOIN tcustomer cus ON cus.cus_kode = so.so_cus_kode
            WHERE LEFT(h.mo_nomor, 3) = ?
              AND h.mo_tanggal BETWEEN ? AND ?
        ) x 
        ORDER BY x.Nomor
    `;
    const [rows] = await pool.query(query, [cabang, startDate, endDate]);
    return rows;
};

const getDetails = async (nomor) => {
    // Query ini telah disesuaikan untuk mengambil semua kolom yang dibutuhkan
    const query = `
        SELECT 
            d.mod_kode AS Kode,
            IFNULL(b.brgd_barcode, '') AS Barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe)) AS Nama,
            d.mod_ukuran AS Ukuran,
            IFNULL(b.brgd_stokmin, 0) AS StokMin,
            IFNULL(b.brgd_stokmax, 0) AS StokMax,
            d.mod_jumlah AS Jumlah,
            d.mod_sj AS SJ
        FROM tmutasiout_dtl d
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.mod_kode
        LEFT JOIN retail.tbarangdc_dtl b ON b.brgd_kode = d.mod_kode AND b.brgd_ukuran = d.mod_ukuran
        WHERE d.mod_nomor = ?
        ORDER BY d.mod_nourut
    `;
    const [rows] = await pool.query(query, [nomor]);
    return rows;
};

const getCabangList = async (user) => {
    let query;
    if (user.cabang === 'KDC') {
        query = 'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode NOT IN ("KBS","KPS") ORDER BY gdg_kode';
    } else {
        query = 'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?';
    }
    const [rows] = await pool.query(query, [user.cabang]);
    return rows;
};

const remove = async (nomor, user) => {
    // ... (Logika hapus dengan validasi status 'OPEN' dan kepemilikan cabang)
    return { message: `Mutasi Out ${nomor} berhasil dihapus.` };
};

module.exports = {
    getList,
    getDetails,
    getCabangList,
    remove,
};
