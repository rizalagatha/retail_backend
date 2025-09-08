const pool = require('../config/database');
const { format } = require('date-fns');
const fs = require('fs');
const path = require('path');

const getSoDtfList = async (filters) => {
    const { startDate, endDate, cabang, filterDateType } = filters;
    let params = [startDate, endDate];

    // Menentukan kolom tanggal yang akan difilter berdasarkan pilihan user
    const dateColumn = filterDateType === 'pengerjaan' ? 'h.sd_datekerja' : 'h.sd_tanggal';

    // Query ini meniru query kompleks dari Delphi Anda
    const query = `
        SELECT 
            x.Nomor, x.Tanggal, x.TglPengerjaan, x.DatelineCus, x.NamaDTF, x.Jumlah, x.Titik, 
            (x.jumlah * x.titik) AS TotalTitik, IFNULL(x.LHK, 0) AS LHK,
            x.NoSO, x.NoINV, x.Sales, x.BagDesain, x.KdCus, x.Customer, x.Kain, 
            x.Finishing, x.Workshop, x.Keterangan, x.AlasanClose, x.Created, x.Close
        FROM (
            SELECT 
                h.sd_nomor AS Nomor, h.sd_tanggal AS Tanggal, h.sd_datekerja AS TglPengerjaan, 
                h.sd_dateline AS DatelineCus, h.sd_nama AS NamaDTF,
                IFNULL((SELECT SUM(i.sdd_jumlah) FROM tsodtf_dtl i WHERE i.sdd_nomor = h.sd_nomor), 0) AS Jumlah,
                IFNULL((SELECT COUNT(*) FROM tsodtf_dtl2 i WHERE i.sdd2_nomor = h.sd_nomor), 0) AS Titik,
                (SELECT SUM(f.depan + f.belakang + f.lengan + f.variasi + f.saku) FROM tdtf f WHERE f.sodtf = h.sd_nomor) AS LHK,
                IFNULL((SELECT dd.sod_so_nomor FROM tso_dtl dd WHERE dd.sod_sd_nomor = h.sd_nomor GROUP BY dd.sod_so_nomor LIMIT 1), "") AS NoSO,
                IFNULL((SELECT dd.invd_inv_nomor FROM tinv_dtl dd WHERE dd.invd_sd_nomor = h.sd_nomor GROUP BY dd.invd_inv_nomor LIMIT 1), "") AS NoINV,
                s.sal_nama AS Sales, h.sd_desain AS BagDesain, h.sd_Workshop AS Workshop,
                h.sd_cus_kode AS KdCus, c.cus_nama AS Customer, h.sd_kain AS Kain, h.sd_finishing AS Finishing,
                h.sd_ket AS Keterangan, h.sd_alasan AS AlasanClose,
                h.user_create AS Created, h.sd_closing AS Close
            FROM tsodtf_hdr h
            LEFT JOIN tcustomer c ON c.cus_kode = h.sd_cus_kode
            LEFT JOIN kencanaprint.tsales s ON s.sal_kode = h.sd_sal_kode
            WHERE h.sd_stok = "" AND ${dateColumn} BETWEEN ? AND ?
            ${cabang !== 'ALL' ? 'AND LEFT(h.sd_nomor, 3) = ?' : ''}
        ) x
        ORDER BY x.Tanggal, x.Nomor;
    `;
    if (cabang !== 'ALL') {
        params.push(cabang);
    }

    const [rows] = await pool.query(query, params);
    return rows;
};

const getSoDtfDetails = async (nomor) => {
    const query = `
        SELECT sdd_ukuran AS Ukuran, sdd_jumlah AS Jumlah 
        FROM tsodtf_dtl WHERE sdd_nomor = ? ORDER BY sdd_nourut
    `;
    const [rows] = await pool.query(query, [nomor]);
    return rows;
};

const closeSoDtf = async (nomor, alasan, user) => {
    const query = `UPDATE tsodtf_hdr SET sd_alasan = ?, sd_closing = 'Y', user_modified = ?, date_modified = NOW() WHERE sd_nomor = ?`;
    const [result] = await pool.query(query, [alasan, user, nomor]);
    if(result.affectedRows === 0) {
        throw new Error('Gagal menutup SO DTF, nomor tidak ditemukan.');
    }
    return { message: 'SO DTF berhasil ditutup.' };
};

/**
 * @description Menghapus data SO DTF setelah validasi.
 * @param {string} nomor - Nomor SO DTF yang akan dihapus.
 * @param {object} user - Objek user yang sedang login.
 */
const remove = async (nomor, user) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        // 1. Ambil data yang akan divalidasi menggunakan query langsung (tanpa view)
        const validationQuery = `
            SELECT 
                h.sd_nomor,
                h.sd_closing AS Close,
                IFNULL((SELECT dd.sod_so_nomor FROM tso_dtl dd WHERE dd.sod_sd_nomor = h.sd_nomor GROUP BY dd.sod_so_nomor LIMIT 1), "") AS NoSO,
                IFNULL((SELECT dd.invd_inv_nomor FROM tinv_dtl dd WHERE dd.invd_sd_nomor = h.sd_nomor GROUP BY dd.invd_inv_nomor LIMIT 1), "") AS NoINV
            FROM tsodtf_hdr h
            WHERE h.sd_nomor = ?
        `;
        const [rows] = await connection.query(validationQuery, [nomor]);

        if (rows.length === 0) {
            throw new Error('Data tidak ditemukan.');
        }
        const record = rows[0];

        // 2. Lakukan semua validasi seperti di Delphi
        if (user.cabang !== 'KDC' && user.cabang !== record.sd_nomor.substring(0, 3)) {
            throw new Error(`Anda tidak berhak menghapus data milik cabang ${record.sd_nomor.substring(0, 3)}.`);
        }
        if (record.NoSO) {
            throw new Error('Sudah dibuat SO, tidak bisa dihapus.');
        }
        if (record.NoINV) {
            throw new Error('Sudah dibuat Invoice, tidak bisa dihapus.');
        }
        if (record.Close === 'Y') {
            throw new Error('Transaksi sudah ditutup, tidak bisa dihapus.');
        }

        // 3. Hapus data dari tabel header
        // PENTING: Diasumsikan foreign key di tsodtf_dtl & tsodtf_dtl2 sudah di-set ON DELETE CASCADE
        await connection.query('DELETE FROM tsodtf_hdr WHERE sd_nomor = ?', [nomor]);

        await connection.commit();

        // 4. Hapus file gambar setelah transaksi DB berhasil
        const cabang = nomor.substring(0, 3);
        const imagePath = path.join(process.cwd(), 'public', 'images', 'sodtf', cabang, `${nomor}.jpg`);
        if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
        }

        return { message: `SO DTF ${nomor} berhasil dihapus.` };
    } catch (error) {
        await connection.rollback();
        throw new Error(error.message || 'Gagal menghapus data.');
    } finally {
        connection.release();
    }
};

module.exports = {
    getSoDtfList,
    getSoDtfDetails,
    closeSoDtf,
    remove,
};
