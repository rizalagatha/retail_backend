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
    // Query ini adalah terjemahan langsung dari subquery 'x' di Delphi
    const query = `
        SELECT 
            h.mi_nomor AS Nomor,
            h.mi_tanggal AS Tanggal,
            i.mo_kecab AS DariCabangKode,
            p.pab_nama AS DariCabangNama,
            h.mi_mo_nomor AS MutasiOut,
            h.mi_so_nomor AS NoSO,
            (SELECT SUM(dd.mid_jumlah) FROM tmutasiin_dtl dd WHERE dd.mid_nomor = h.mi_nomor) AS Qty,
            o.so_cus_kode AS KdCus,
            c.cus_nama AS Customer,
            c.cus_alamat AS Alamat,
            c.cus_kota AS Kota,
            h.mi_ket AS Keterangan,
            h.user_create AS Usr,
            IFNULL((SELECT inv_nomor FROM tinv_hdr v WHERE v.inv_nomor_so = h.mi_so_nomor ORDER BY v.inv_nomor DESC LIMIT 1), "") AS Invoice
        FROM tmutasiin_hdr h
        LEFT JOIN tmutasiout_hdr i ON i.mo_nomor = h.mi_mo_nomor
        LEFT JOIN kencanaprint.tpabrik p ON p.pab_kode = i.mo_kecab
        LEFT JOIN tso_hdr o ON o.so_nomor = h.mi_so_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = o.so_cus_kode
        WHERE LEFT(h.mi_nomor, 3) = ? 
          AND h.mi_tanggal BETWEEN ? AND ?
        ORDER BY h.mi_nomor DESC;
    `;
    const [rows] = await pool.query(query, [cabang, startDate, endDate]);
    return rows;
};

const getDetails = async (nomor) => {
    const query = `
        SELECT 
            d.mid_kode AS Kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS Nama,
            d.mid_ukuran AS Ukuran,
            d.mid_jumlah AS Qty
        FROM tmutasiin_dtl d
        INNER JOIN tmutasiin_hdr h ON h.mi_nomor = d.mid_nomor
        LEFT JOIN tbarangdc a ON a.brg_kode = d.mid_kode
        WHERE d.mid_nomor = ?
        ORDER BY d.mid_kode, d.mid_ukuran;
    `;
    const [rows] = await pool.query(query, [nomor]);
    return rows;
};

const getExportDetails = async (filters) => {
    const { startDate, endDate, cabang } = filters;
    const query = `
        SELECT 
            h.mi_nomor AS 'Nomor Mutasi In',
            h.mi_tanggal AS 'Tanggal',
            h.mi_mo_nomor AS 'Nomor Mutasi Out',
            h.mi_so_nomor AS 'Nomor SO',
            c.cus_nama AS 'Customer',
            d.mid_kode AS 'Kode Barang',
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS 'Nama Barang',
            d.mid_ukuran AS 'Ukuran',
            d.mid_jumlah AS 'Qty'
        FROM tmutasiin_hdr h
        JOIN tmutasiin_dtl d ON h.mi_nomor = d.mid_nomor
        LEFT JOIN tso_hdr o ON o.so_nomor = h.mi_so_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = o.so_cus_kode
        LEFT JOIN tbarangdc a ON a.brg_kode = d.mid_kode
        WHERE LEFT(h.mi_nomor, 3) = ? 
          AND h.mi_tanggal BETWEEN ? AND ?
        ORDER BY h.mi_nomor;
    `;
    const [rows] = await pool.query(query, [cabang, startDate, endDate]);
    return rows;
};

const remove = async (nomor, user) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const [rows] = await connection.query(`
            SELECT 
                h.mi_so_nomor, 
                IFNULL((SELECT inv_nomor FROM tinv_hdr v WHERE v.inv_nomor_so = h.mi_so_nomor LIMIT 1), "") AS Invoice
            FROM tmutasiin_hdr h WHERE h.mi_nomor = ?
        `, [nomor]);

        if (rows.length === 0) throw new Error('Data tidak ditemukan.');
        const mutasi = rows[0];

        if (mutasi.Invoice) throw new Error('Sudah dibuat invoice. Tidak bisa dihapus.');
        if (nomor.substring(0, 3) !== user.cabang) throw new Error('Anda tidak berhak menghapus data milik cabang lain.');

        await connection.query('DELETE FROM tmutasiin_hdr WHERE mi_nomor = ?', [nomor]);
        // Asumsi tmutasiin_dtl akan terhapus via ON DELETE CASCADE

        await connection.commit();
        return { message: `Mutasi In ${nomor} berhasil dihapus.` };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = { getCabangList, getList, getDetails, getExportDetails, remove };
