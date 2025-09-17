const pool = require('../config/database');

const getCabangList = async (user) => {
    // Pola yang sama dari form sebelumnya
    let query = '';
    const params = [];
    if (user.cabang === 'KDC') {
        query = 'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc IN (0, 3) ORDER BY gdg_kode';
    } else {
        query = 'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ? ORDER BY gdg_kode';
        params.push(user.cabang);
    }
    const [rows] = await pool.query(query, params);
    return rows;
};

const getList = async (filters) => {
    const { startDate, endDate, cabang } = filters;
    const query = `
        SELECT 
            h.mso_nomor AS Nomor,
            h.mso_tanggal AS Tanggal,
            IF(h.mso_jenis="SP", "Showroom ke Pesanan", "Pesanan ke Showroom") AS Jenis,
            h.mso_so_nomor AS NoSO,
            IFNULL((SELECT inv_nomor FROM tinv_hdr v WHERE inv_nomor_so = h.mso_so_nomor ORDER BY v.inv_nomor DESC LIMIT 1), "") AS Invoice,
            o.so_cus_kode AS KdCus,
            c.cus_nama AS Customer,
            c.cus_alamat AS Alamat,
            c.cus_kota AS Kota,
            h.mso_ket AS Keterangan,
            h.user_create AS Usr
        FROM tmutasistok_hdr h
        LEFT JOIN tso_hdr o ON o.so_nomor = h.mso_so_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = o.so_cus_kode
        WHERE LEFT(h.mso_nomor, 3) = ? 
          AND h.mso_tanggal BETWEEN ? AND ?
        ORDER BY h.mso_nomor DESC;
    `;
    const [rows] = await pool.query(query, [cabang, startDate, endDate]);
    return rows;
};

const getDetails = async (nomor) => {
    const query = `
        SELECT 
            d.msod_kode AS Kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS Nama,
            d.msod_ukuran AS Ukuran,
            d.msod_jumlah AS Qty
        FROM tmutasistok_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.msod_kode
        WHERE d.msod_nomor = ?
        ORDER BY d.msod_kode, d.msod_ukuran;
    `;
    const [rows] = await pool.query(query, [nomor]);
    return rows;
};

const remove = async (nomor, user) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const [rows] = await connection.query(`
            SELECT 
                h.mso_so_nomor, 
                IFNULL((SELECT inv_nomor FROM tinv_hdr v WHERE v.inv_nomor_so = h.mso_so_nomor LIMIT 1), "") AS Invoice
            FROM tmutasistok_hdr h WHERE h.mso_nomor = ?
        `, [nomor]);

        if (rows.length === 0) throw new Error('Data tidak ditemukan.');
        const mutasi = rows[0];

        if (mutasi.Invoice) throw new Error('Sudah dibuat invoice. Tidak bisa dihapus.');
        if (nomor.substring(0, 3) !== user.cabang) throw new Error('Anda tidak berhak menghapus data milik cabang lain.');

        await connection.query('DELETE FROM tmutasistok_hdr WHERE mso_nomor = ?', [nomor]);
        
        await connection.commit();
        return { message: `Mutasi Stok ${nomor} berhasil dihapus.` };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = { getCabangList, getList, getDetails, remove };