const pool = require('../config/database');

const getList = async (filters) => {
    const { startDate, endDate, productCode } = filters;
    let params = [startDate, endDate];
    
    let productFilter = '';
    if (productCode) {
        productFilter = 'AND d.sjd_kode = ?';
        params.push(productCode);
    }
    
    const query = `
        SELECT DISTINCT 
            h.sj_nomor AS Nomor, h.sj_tanggal AS Tanggal, h.sj_kecab AS Store,
            g.gdg_nama AS Nama_Store, h.sj_mt_nomor AS NoMinta, m.mt_tanggal AS TglMinta,
            IFNULL(m.mt_otomatis, "") AS MintaOtomatis, h.sj_noterima AS NomorTerima,
            t.tj_tanggal AS TglTerima, h.sj_ket AS Keterangan, h.sj_stbj AS NoSTBJ,
            IFNULL((
                SELECT CASE 
                    WHEN pin_acc = "" AND pin_dipakai = "" THEN "WAIT"
                    WHEN pin_acc = "Y" AND pin_dipakai = "" THEN "ACC"
                    WHEN pin_acc = "N" THEN "TOLAK"
                    ELSE ""
                END
                FROM kencanaprint.tspk_pin5 
                WHERE pin_trs = "SURAT JALAN" AND pin_nomor = h.sj_nomor 
                ORDER BY pin_urut DESC LIMIT 1
            ), "") AS Ngedit,
            h.user_create AS Usr,
            h.sj_closing AS Closing
        FROM tdc_sj_hdr h
        JOIN tdc_sj_dtl d ON d.sjd_nomor = h.sj_nomor
        LEFT JOIN retail.tgudang g ON g.gdg_kode = h.sj_kecab
        LEFT JOIN retail.ttrm_sj_hdr t ON t.tj_nomor = h.sj_noterima
        LEFT JOIN retail.tmintabarang_hdr m ON m.mt_nomor = h.sj_mt_nomor
        WHERE h.sj_peminta = "" AND h.sj_tanggal BETWEEN ? AND ?
        ${productFilter}
        ORDER BY h.date_create DESC
    `;
    const [rows] = await pool.query(query, params);
    return rows;
};

const getDetails = async (nomor) => { /* ... (Implementasi query detail) ... */ };
const remove = async (nomor, user) => { /* ... (Implementasi remove dengan validasi dari Delphi) ... */ };
const requestChange = async (data, user) => { /* ... (Implementasi INSERT ke tspk_pin5) ... */ };

module.exports = { getList, getDetails, remove, requestChange };
