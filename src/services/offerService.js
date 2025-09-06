const pool = require('../config/database');
const { format } = require('date-fns');

const getOffers = async (startDate, endDate, cabang) => {
    let params = [startDate, endDate];
    let branchFilter = '';

    // Meniru logika filter cabang dari Delphi
    if (cabang === 'KDC') {
        branchFilter = 'AND LEFT(h.pen_nomor, 3) IN (SELECT gdg_kode FROM tgudang WHERE gdg_dc = 1)';
    } else {
        branchFilter = 'AND LEFT(h.pen_nomor, 3) = ?';
        params.push(cabang);
    }

    const query = `
        SSELECT 
            h.pen_nomor AS nomor,
            h.pen_tanggal AS tanggal,
            IFNULL((SELECT so.so_nomor FROM tso_hdr so WHERE so.so_pen_nomor = h.pen_nomor LIMIT 1), '') AS noSO,
            h.pen_top AS top,
            DATE_ADD(h.pen_tanggal, INTERVAL h.pen_top DAY) as tempo,
            h.pen_ppn AS ppn,
            h.pen_disc1 AS \`disc%\`,
            h.pen_disc AS diskon,
            h.pen_cus_kode AS kdcus,
            c.cus_nama AS nama,
            c.cus_kota AS kota,
            c.cus_telp AS telp,
            CONCAT(h.pen_cus_level, ' - ', l.level_nama) AS level,
            h.pen_ket AS keterangan,
            h.pen_alasan AS alasan,
            h.user_create AS created,
            (
                SELECT ROUND(SUM(dd.pend_jumlah * (dd.pend_harga - dd.pend_diskon)) - hh.pen_disc + (hh.pen_ppn/100 * (SUM(dd.pend_jumlah * (dd.pend_harga - dd.pend_diskon)) - hh.pen_disc)) + hh.pen_bkrm)
                FROM tpenawaran_dtl dd
                LEFT JOIN tpenawaran_hdr hh ON hh.pen_nomor = dd.pend_nomor
                WHERE hh.pen_nomor = h.pen_nomor
            ) AS nominal,
            h.pen_alasan AS alasanClose,
            (SELECT inv.inv_nomor FROM tinvoice_hdr inv WHERE inv.inv_pen_nomor = h.pen_nomor LIMIT 1) AS noINV
        FROM tpenawaran_hdr h
        LEFT JOIN tcustomer c ON h.pen_cus_kode = c.cus_kode
        LEFT JOIN tcustomer_level l ON l.level_kode = h.pen_cus_level
        WHERE h.pen_tanggal BETWEEN ? AND ?
    `;

    const [rows] = await pool.query(query, params);
    return rows;
};

const getOfferDetails = async (nomor) => {
    // Query ini adalah adaptasi dari query detail di Delphi Anda
    const query = `
        SELECT
            d.pend_kode AS kode,
            IFNULL(b.brgd_barcode, "") AS barcode,
            IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe)), f.sd_nama) AS nama,
            d.pend_ukuran AS ukuran,
            d.pend_jumlah AS qty,
            d.pend_harga AS harga,
            d.pend_diskon AS diskon,
            (d.pend_jumlah * (d.pend_harga - d.pend_diskon)) AS total
        FROM tpenawaran_dtl d
        LEFT JOIN tpenawaran_hdr h ON h.pen_nomor = d.pend_nomor
        LEFT JOIN tbarangdc a ON a.brg_kode = d.pend_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.pend_kode AND b.brgd_ukuran = d.pend_ukuran
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.pend_kode
        WHERE d.pend_nomor = ?
        ORDER BY d.pend_nourut;
    `;
    const [rows] = await pool.query(query, [nomor]);
    return rows;
};

const getDataForPrinting = async (nomor) => {
    // 1. Ambil data Header dan Customer
    const headerQuery = `
        SELECT h.*, c.* FROM tpenawaran_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
        WHERE h.pen_nomor = ?;
    `;
    const [headerRows] = await pool.query(headerQuery, [nomor]);
    if (headerRows.length === 0) {
        throw { status: 404, message: 'Data penawaran tidak ditemukan.' };
    }
    const header = headerRows[0];

    // 2. Ambil data Gudang
    const gudangQuery = `SELECT * FROM tgudang WHERE gdg_kode = ?;`;
    const [gudangRows] = await pool.query(gudangQuery, [header.pen_nomor.substring(0, 3)]);
    const gudang = gudangRows[0];

    // 3. Ambil data Detail
    const detailsQuery = `
        SELECT 
            d.pend_kode AS kode, IFNULL(b.brgd_barcode, "") AS barcode,
            IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe)), "") AS nama,
            d.pend_ukuran AS ukuran, d.pend_jumlah AS qty, d.pend_harga AS harga,
            d.pend_diskon AS diskon,
            (d.pend_jumlah * (d.pend_harga - d.pend_diskon)) as total
        FROM tpenawaran_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.pend_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.pend_kode AND b.brgd_ukuran = d.pend_ukuran
        WHERE d.pend_nomor = ? ORDER BY d.pend_nourut;
    `;
    const [details] = await pool.query(detailsQuery, [nomor]);

    // 4. Siapkan data Footer (kalkulasi)
    const total = details.reduce((sum, item) => sum + item.total, 0);
    const diskon_faktur = header.pen_disc || 0;
    const netto = total - diskon_faktur;
    const ppn = header.pen_ppn ? netto * (header.pen_ppn / 100) : 0;
    const footer = {
        total: total,
        diskon_faktur: diskon_faktur,
        ppn: ppn,
        bkrm: header.pen_bkrm || 0,
        netto: netto,
    };

    // Kembalikan semua data dalam satu objek
    return { header, details, customer: header, gudang, footer };
};

const getExportDetails = async (startDate, endDate, cabang) => {
    const query = `
        SELECT 
            h.pen_nomor AS 'Nomor Penawaran',
            h.pen_tanggal AS 'Tanggal',
            h.pen_cus_kode AS 'Kode Customer',
            c.cus_nama AS 'Nama Customer',
            d.pend_kode AS 'Kode Barang',
            IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe)), f.sd_nama) AS 'Nama Barang',
            d.pend_ukuran AS 'Ukuran',
            d.pend_jumlah AS 'Qty',
            d.pend_harga AS 'Harga',
            d.pend_diskon AS 'Diskon',
            (d.pend_jumlah * (d.pend_harga - d.pend_diskon)) AS 'Total'
        FROM tpenawaran_hdr h
        JOIN tpenawaran_dtl d ON h.pen_nomor = d.pend_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
        LEFT JOIN tbarangdc a ON a.brg_kode = d.pend_kode
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.pend_kode
        WHERE h.pen_tanggal BETWEEN ? AND ?
        AND LEFT(h.pen_nomor, 3) = ?
        ORDER BY h.pen_nomor, d.pend_nourut;
    `;
    const [rows] = await pool.query(query, [startDate, endDate, cabang]);
    return rows;
};

const getBranchOptions = async (userCabang) => {
    let query = '';
    if (userCabang === 'KDC') {
        query = 'SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode NOT IN ("KBS","KPS") ORDER BY gdg_kode';
    } else {
        query = `SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode = '${userCabang}'`;
    }
    const [rows] = await pool.query(query);
    return rows;
};

const closeOffer = async (nomor, alasan) => {
    const query = `
        UPDATE tpenawaran_hdr 
        SET pen_alasan = ? 
        WHERE pen_nomor = ?;
    `;
    await pool.query(query, [alasan, nomor]);
    return { success: true, message: `Penawaran ${nomor} berhasil ditutup.` };
};

const deleteOffer = async (nomor) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Hapus semua item detail terlebih dahulu
        await connection.query('DELETE FROM tpenawaran_dtl WHERE pend_nomor = ?', [nomor]);
        
        // 2. Hapus header transaksinya
        await connection.query('DELETE FROM tpenawaran_hdr WHERE pen_nomor = ?', [nomor]);

        await connection.commit();
        return { success: true, message: `Penawaran ${nomor} berhasil dihapus.` };
    } catch (error) {
        await connection.rollback();
        console.error("Error deleting offer:", error);
        throw new Error('Gagal menghapus data penawaran.');
    } finally {
        connection.release();
    }
};

module.exports = {
    getOffers,
    getOfferDetails,
    getDataForPrinting,
    getExportDetails,
    getBranchOptions,
    closeOffer,
    deleteOffer,
};
