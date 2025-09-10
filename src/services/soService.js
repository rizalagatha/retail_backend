const pool = require('../config/database');

// Mengambil daftar data (SQLMaster)
const getList = async (filters) => {
    const { startDate, endDate, cabang } = filters;
    let params = [startDate, endDate];

    let branchFilter = '';
    if (cabang === 'KDC') {
        branchFilter = 'AND LEFT(h.so_nomor, 3) IN (SELECT gdg_kode FROM tgudang WHERE gdg_dc = 1)';
    } else {
        branchFilter = 'AND LEFT(h.so_nomor, 3) = ?';
        params.push(cabang);
    }

    // Query ini mereplikasi semua sub-query dan kalkulasi status dari Delphi
    const query = `
        SELECT 
            y.Nomor, y.Tanggal, y.Dateline, y.Penawaran, y.Top, y.Nominal, y.Diskon, y.Dp, 
            y.QtySO, y.QtyInv, y.Belum, y.AlasanClose, y.StatusKirim, y.kdcus, y.Nama, 
            y.Alamat, y.Kota, y.Level, y.Keterangan, y.Aktif, y.SC,
            (CASE
                WHEN y.sts = 2 THEN "DICLOSE"
                WHEN y.StatusKirim = "TERKIRIM" THEN "CLOSE"
                WHEN y.StatusKirim = "BELUM" AND y.keluar = 0 AND y.minta = "" AND y.pesan = 0 THEN "OPEN"
                WHEN y.StatusKirim = "BELUM" AND y.QtySO = y.pesan THEN "JADI"
                ELSE "PROSES"
            END) AS Status
        FROM (
            SELECT 
                x.*,
                IF(x.QtyInv = 0, "BELUM", IF(x.QtyInv >= x.QtySO, "TERKIRIM", "SEBAGIAN")) AS StatusKirim,
                IFNULL((SELECT SUM(m.mst_stok_out) FROM tmasterstok m WHERE m.mst_noreferensi IN (SELECT o.mo_nomor FROM tmutasiout_hdr o WHERE o.mo_so_nomor = x.Nomor) AND mid(m.mst_noreferensi, 4, 3) NOT IN ("MSO", "MSI")), 0) AS keluar,
                IFNULL((SELECT m.mt_nomor FROM tmintabarang_hdr m WHERE m.mt_so = x.Nomor LIMIT 1), "") AS minta,
                IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstokso m WHERE m.mst_aktif = "Y" AND m.mst_nomor_so = x.Nomor), 0) AS pesan
            FROM (
                SELECT 
                    h.so_nomor AS Nomor, h.so_pen_nomor AS Penawaran, h.so_dateline AS Dateline, h.so_tanggal AS Tanggal, 
                    h.so_top AS Top, h.so_disc AS Diskon, h.so_dp AS Dp,
                    (SELECT ROUND(SUM(dd.sod_jumlah * (dd.sod_harga - dd.sod_diskon)) - hh.so_disc + (hh.so_ppn / 100 * (SUM(dd.sod_jumlah * (dd.sod_harga - dd.sod_diskon)) - hh.so_disc)) + hh.so_bkrm) FROM tso_dtl dd JOIN tso_hdr hh ON hh.so_nomor = dd.sod_so_nomor WHERE hh.so_nomor = h.so_nomor) AS Nominal,
                    IFNULL((SELECT SUM(dd.sod_jumlah) FROM tso_dtl dd WHERE dd.sod_so_nomor = h.so_nomor), 0) AS QtySO,
                    IFNULL((SELECT SUM(dd.invd_jumlah) FROM tinv_hdr hh JOIN tinv_dtl dd ON dd.invd_inv_nomor = hh.inv_nomor WHERE hh.inv_sts_pro = 0 AND hh.inv_nomor_so = h.so_nomor), 0) AS QtyInv,
                    (IFNULL((SELECT SUM(dd.sod_jumlah) FROM tso_dtl dd WHERE dd.sod_so_nomor = h.so_nomor), 0) - IFNULL((SELECT SUM(dd.invd_jumlah) FROM tinv_hdr hh JOIN tinv_dtl dd ON dd.invd_inv_nomor = hh.inv_nomor WHERE hh.inv_sts_pro = 0 AND hh.inv_nomor_so = h.so_nomor), 0)) AS Belum,
                    h.so_cus_kode AS kdcus, s.cus_nama AS Nama, s.cus_alamat AS Alamat, s.cus_kota AS Kota, 
                    CONCAT(h.so_cus_level, " - ", l.level_nama) AS Level, h.so_ket AS Keterangan, 
                    h.so_close AS sts, h.so_aktif AS Aktif, h.so_alasan AS AlasanClose, h.so_sc AS SC
                FROM tso_hdr h
                LEFT JOIN tcustomer s ON s.cus_kode = h.so_cus_kode
                LEFT JOIN tcustomer_level l ON l.level_kode = h.so_cus_level
                WHERE h.so_tanggal BETWEEN ? AND ? ${branchFilter}
            ) x
        ) y
        ORDER BY y.Tanggal, y.Nomor
    `;
    const [rows] = await pool.query(query, params);
    return rows;
};

const getCabangList = async (user) => {
    let query;
    // Logika dari FormCreate Delphi
    if (user.cabang === 'KDC') {
        // Untuk KDC, ambil semua cabang kecuali KBS dan KPS
        query = `SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode NOT IN ("KBS", "KPS") ORDER BY gdg_kode`;
    } else {
        // Untuk cabang biasa, hanya ambil cabangnya sendiri
        query = `SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode = ?`;
    }
    const [rows] = await pool.query(query, [user.cabang]);
    
    return rows;
};

// Mengambil data detail (SQLDetail)
const getDetails = async (nomor) => {
    // Query ini adalah migrasi dari SQLDetail di Delphi Anda
    const query = `
        SELECT 
            x.Kode, x.Barcode, x.Nama, x.Ukuran, x.QtySO, x.Harga, x.TotalSO, x.QtyInvoice,
            (IF(x.QtyInvoice >= x.QtySO, 0, x.QtySO - x.QtyInvoice)) AS BlmJadiInvoice 
        FROM (
            SELECT 
                d.sod_kode AS Kode,
                IFNULL(b.brgd_barcode, "") AS Barcode,
                IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe)), f.sd_nama) AS Nama,
                d.sod_ukuran AS Ukuran,
                d.sod_jumlah AS QtySO,
                d.sod_harga AS Harga,
                (d.sod_jumlah * (d.sod_harga - d.sod_diskon)) AS TotalSO,
                IFNULL((
                    SELECT SUM(i.invd_jumlah) 
                    FROM tinv_hdr j 
                    JOIN tinv_dtl i ON i.invd_inv_nomor = j.inv_nomor
                    WHERE j.inv_sts_pro = 0 
                      AND j.inv_nomor_so = h.so_nomor 
                      AND i.invd_kode = d.sod_kode 
                      AND i.invd_ukuran = d.sod_ukuran
                ), 0) AS QtyInvoice
            FROM tso_dtl d
            JOIN tso_hdr h ON h.so_nomor = d.sod_so_nomor
            LEFT JOIN tbarangdc a ON a.brg_kode = d.sod_kode
            LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sod_kode AND b.brgd_ukuran = d.sod_ukuran
            LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.sod_kode
            WHERE d.sod_so_nomor = ?
        ) x
        ORDER BY x.Kode, x.Ukuran
    `;
    const [rows] = await pool.query(query, [nomor]);
    return rows;
};

function terbilang(n) {
    if (n === null || n === undefined || n === 0) return "Nol";
    if (n < 0) return "minus " + terbilang(-n);
    const ang = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
    const terbilangRecursive = (num) => {
        if (num < 12) return ang[num];
        if (num < 20) return terbilangRecursive(num - 10) + " belas";
        if (num < 100) return ang[Math.floor(num / 10)] + " puluh " + terbilangRecursive(num % 10);
        if (num < 200) return "seratus " + terbilangRecursive(num - 100);
        if (num < 1000) return terbilangRecursive(Math.floor(num / 100)) + " ratus " + terbilangRecursive(num % 100);
        if (num < 2000) return "seribu " + terbilangRecursive(num - 1000);
        if (num < 1000000) return terbilangRecursive(Math.floor(num / 1000)) + " ribu " + terbilangRecursive(num % 1000);
        if (num < 1000000000) return terbilangRecursive(Math.floor(num / 1000000)) + " juta " + terbilangRecursive(n % 1000000);
        return "angka terlalu besar";
    };
    return terbilangRecursive(Math.floor(n)).replace(/\s+/g, ' ').trim();
}
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '');
// --- Akhir Fungsi Helper ---


const getDataForPrint = async (nomor) => {
    // 1. Ambil data Header, Customer, dan Gudang
    const headerQuery = `
        SELECT 
            h.so_nomor, h.so_tanggal, h.so_top, h.so_ket, h.so_sc, h.user_create,
            DATE_FORMAT(h.date_create, "%d-%m-%Y %T") AS created,
            h.so_disc, h.so_ppn, h.so_bkrm, h.so_dp,
            c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp,
            g.gdg_inv_nama, g.gdg_inv_alamat, g.gdg_inv_kota, g.gdg_inv_telp,
            g.gdg_inv_instagram
        FROM tso_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
        LEFT JOIN tgudang g ON g.gdg_kode = LEFT(h.so_nomor, 3)
        WHERE h.so_nomor = ?
    `;
    const [headerRows] = await pool.query(headerQuery, [nomor]);
    if (headerRows.length === 0) return null;
    const header = headerRows[0];

    // 2. Ambil data Detail
    const detailQuery = `
        SELECT 
            IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe)), f.sd_nama) AS nama_barang,
            d.sod_ukuran AS ukuran,
            d.sod_jumlah AS qty,
            d.sod_harga AS harga,
            d.sod_diskon AS diskon,
            (d.sod_jumlah * (d.sod_harga - d.sod_diskon)) AS total
        FROM tso_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.sod_kode
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.sod_kode
        WHERE d.sod_so_nomor = ? 
        ORDER BY d.sod_nourut
    `;
    const [details] = await pool.query(detailQuery, [nomor]);

    // 3. Kalkulasi Total & Terbilang di backend
    const total = details.reduce((sum, item) => sum + item.total, 0);
    const diskon_faktur = header.so_disc || 0;
    const netto = total - diskon_faktur;
    const ppn = header.so_ppn ? netto * (header.so_ppn / 100) : 0;
    const grand_total = netto + ppn + (header.so_bkrm || 0);
    const belumbayar = grand_total - (header.so_dp || 0);

    const summary = {
        total,
        diskon: diskon_faktur,
        ppn: ppn,
        biaya_kirim: header.so_bkrm || 0,
        grand_total,
        dp: header.so_dp || 0,
        belumbayar,
        terbilang: capitalize(terbilang(grand_total)) + " Rupiah",
    };

    return { header, details, summary };
};

// ... (Implementasi fungsi lain seperti getCabangList, close, remove)

module.exports = {
    getList,
    getCabangList,
    getDetails,
    getDataForPrint,
    // ...
};
