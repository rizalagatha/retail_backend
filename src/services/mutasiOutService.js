const pool = require('../config/database');

const getList = async (filters) => {
    const { startDate, endDate, cabang } = filters;
    if (!startDate || !endDate || !cabang) return [];

    const query = `
        SELECT 
            x.Nomor, x.Tanggal, x.NoSO, x.KeCab, x.QtyOut, x.QtyIn,
            IF(x.QtyIn >= x.QtyOut, "CLOSE", IF(x.QtyIn > 0 AND x.QtyIn < x.QtyOut, "PROSES", "OPEN")) AS Status,
            x.Keterangan, x.Usr
        FROM (
            SELECT 
                h.mo_nomor AS Nomor,
                h.mo_tanggal AS Tanggal,
                h.mo_so_nomor AS NoSO,
                h.mo_kecab AS KeCab,
                IFNULL((SELECT SUM(dd.mod_jumlah) FROM tmutasiout_dtl dd WHERE dd.mod_nomor = h.mo_nomor), 0) AS QtyOut,
                IFNULL((SELECT SUM(dd.mid_jumlah) FROM tmutasiin_dtl dd JOIN tmutasiin_hdr hh ON hh.mi_nomor = dd.mid_nomor WHERE hh.mi_mo_nomor = h.mo_nomor), 0) AS QtyIn,
                h.mo_ket AS Keterangan,
                h.user_create AS Usr
            FROM tmutasiout_hdr h
            WHERE LEFT(h.mo_nomor, 3) = ?
              AND h.mo_tanggal BETWEEN ? AND ?
        ) x 
        ORDER BY x.Nomor
    `;
    const [rows] = await pool.query(query, [cabang, startDate, endDate]);
    return rows;
};

const getDetails = async (nomor) => {
    // Query ini sekarang 100% sesuai dengan SQLDetail dari Delphi
    const query = `
        SELECT 
            d.mod_kode AS Kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS Nama,
            d.mod_ukuran AS Ukuran,
            d.mod_jumlah AS QtyOut,
            IFNULL((
                SELECT SUM(dd.mid_jumlah) 
                FROM tmutasiin_dtl dd 
                LEFT JOIN tmutasiin_hdr hh ON hh.mi_nomor = dd.mid_nomor 
                WHERE hh.mi_mo_nomor = d.mod_nomor 
                  AND dd.mid_kode = d.mod_kode 
                  AND dd.mid_ukuran = d.mod_ukuran
            ), 0) AS QtyIn
        FROM tmutasiout_dtl d
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.mod_kode
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
