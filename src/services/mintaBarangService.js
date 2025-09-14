const pool = require('../config/database');

const getList = async (filters) => {
    const { startDate, endDate, cabang, jenisPermintaan } = filters;
    let params = [startDate, endDate];

    let branchFilter = '';
    if (cabang !== 'ALL') {
        branchFilter = 'AND LEFT(h.mt_nomor, 3) = ?';
        params.push(cabang);
    }

    let jenisFilter = '';
    if (jenisPermintaan === 'manual') {
        jenisFilter = 'AND h.mt_otomatis = "N"';
    } else if (jenisPermintaan === 'otomatis') {
        jenisFilter = 'AND h.mt_otomatis = "Y"';
    }
    
    const query = `
        SELECT 
            h.mt_nomor AS Nomor,
            h.mt_tanggal AS Tanggal,
            h.mt_so AS NoSO,
            IFNULL((SELECT j.sj_nomor FROM tdc_sj_hdr j WHERE j.sj_mt_nomor = h.mt_nomor ORDER BY j.sj_tanggal DESC LIMIT 1), "") AS NoSJ,
            IFNULL((SELECT j.sj_noterima FROM tdc_sj_hdr j WHERE j.sj_mt_nomor = h.mt_nomor ORDER BY j.sj_tanggal DESC LIMIT 1), "") AS TerimaSJ,
            h.mt_cus AS KdCus,
            c.cus_nama AS Customer,
            h.mt_ket AS Keterangan,
            h.mt_otomatis AS Otomatis,
            h.user_create AS Created,
            h.mt_closing AS Closing
        FROM tmintabarang_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.mt_cus
        WHERE h.mt_tanggal BETWEEN ? AND ?
        ${branchFilter}
        ${jenisFilter}
        ORDER BY h.mt_nomor
    `;
    const [rows] = await pool.query(query, params);
    return rows;
};

const getDetails = async (nomor) => {
    const query = `
        SELECT 
            d.mtd_kode AS Kode,
            b.brgd_barcode AS Barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe)) AS Nama,
            d.mtd_ukuran AS Ukuran,
            IFNULL(b.brgd_min, 0) AS StokMinimal,
            IFNULL(b.brgd_max, 0) AS StokMaximal,
            d.mtd_jumlah AS Jumlah,
            IFNULL((
                SELECT SUM(i.sjd_jumlah) FROM tdc_sj_hdr j
                JOIN tdc_sj_dtl i ON i.sjd_nomor = j.sj_nomor
                WHERE j.sj_mt_nomor = d.mtd_nomor 
                  AND i.sjd_kode = d.mtd_kode 
                  AND i.sjd_ukuran = d.mtd_ukuran
            ), 0) AS SJ
        FROM tmintabarang_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.mtd_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.mtd_kode AND b.brgd_ukuran = d.mtd_ukuran
        WHERE d.mtd_nomor = ?
        ORDER BY d.mtd_nourut
    `;
    const [rows] = await pool.query(query, [nomor]);
    return rows;
};

const getCabangList = async (user) => {
    let query;
    let params = [];

    // Logika dari FormCreate Delphi
    if (user.cabang === 'KDC') {
        // Untuk KDC, ambil gudang dengan tipe 0 (Biasa) atau 3 (Prioritas)
        query = `SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_dc IN (0, 3) ORDER BY gdg_kode`;
    } else {
        // Untuk cabang biasa, hanya ambil cabangnya sendiri
        query = `SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode = ? ORDER BY gdg_kode`;
        params.push(user.cabang);
    }
    
    const [rows] = await pool.query(query, params);
    
    // Tambahkan opsi "ALL" untuk KDC, sesuai logika Delphi
    if (user.cabang === 'KDC') {
        return [{ kode: 'ALL', nama: 'SEMUA CABANG' }, ...rows];
    }

    return rows;
};

const remove = async (nomor, user) => { /* ... (Logika remove dengan validasi dari Delphi) ... */ };

module.exports = { getList, getDetails, getCabangList, remove };
