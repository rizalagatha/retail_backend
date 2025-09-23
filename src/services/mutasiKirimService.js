const pool = require('../config/database');

const getCabangList = async (user) => {
    let query = '';
    const params = [];

    // Logika dari TfrmBrowMSK.FormCreate
    if (user.cabang === 'KDC') {
        query = 'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc = 0 ORDER BY gdg_kode';
    } else {
        query = 'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ? ORDER BY gdg_kode';
        params.push(user.cabang);
    }
    const [rows] = await pool.query(query, params);
    return rows;
};

const getList = async (filters) => {
    const { startDate, endDate, cabang, itemCode } = filters;

    const query = `
        SELECT
            h.msk_nomor AS nomor,
            h.msk_tanggal AS tanggal,
            h.msk_noterima AS nomorTerima,
            t.mst_tanggal AS tglTerima,
            h.msk_kecab AS storeTujuan,
            g.gdg_nama AS namaStoreTujuan,
            h.msk_ket AS keterangan,
            h.user_create AS usr,
            h.msk_closing AS 'closing'
        FROM tmsk_hdr h
        INNER JOIN tmsk_dtl d ON d.mskd_nomor = h.msk_nomor
        LEFT JOIN retail.tgudang f ON f.gdg_kode = LEFT(h.msk_nomor, 3)
        LEFT JOIN retail.tgudang g ON g.gdg_kode = h.msk_kecab
        LEFT JOIN retail.tmst_hdr t ON t.mst_nomor = h.msk_noterima
        WHERE
            h.msk_tanggal BETWEEN ? AND ?
            AND f.gdg_kode = ?
            AND (? IS NULL OR d.mskd_kode = ?)
        GROUP BY h.msk_nomor
        ORDER BY h.msk_tanggal DESC, h.msk_nomor DESC;
    `;

    const params = [startDate, endDate, cabang, itemCode || null, itemCode];
    const [rows] = await pool.query(query, params);
    return rows;
};

const getDetails = async (nomor) => {
    const query = `
        SELECT
            d.mskd_kode AS kode,
            TRIM(CONCAT(a.brg_jeniskaos, ' ', a.brg_tipe, ' ', a.brg_lengan, ' ', a.brg_jeniskain, ' ', a.brg_warna)) AS nama,
            d.mskd_ukuran AS ukuran,
            d.mskd_jumlah AS jumlah
        FROM tmsk_dtl d
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.mskd_kode
        WHERE d.mskd_nomor = ?
    `;
    const [rows] = await pool.query(query, [nomor]);
    return rows;
};

const remove = async (nomor, user) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [rows] = await connection.query('SELECT msk_noterima, msk_closing FROM tmsk_hdr WHERE msk_nomor = ?', [nomor]);

        if (rows.length === 0) throw new Error('Data tidak ditemukan.');
        const doc = rows[0];

        // Validasi dari TfrmBrowMSK.cxButton4Click
        if (doc.msk_noterima) throw new Error('Sudah ada penerimaan. Tidak bisa dihapus.');
        if (doc.msk_closing === 'Y') throw new Error('Sudah Close Transaksi. Tidak bisa dihapus.');
        if (nomor.substring(0, 3) !== user.cabang && user.cabang !== 'KDC') {
            throw new Error(`Anda tidak berhak menghapus data milik store ${nomor.substring(0, 3)}.`);
        }

        // Hapus detail dan header
        await connection.query('DELETE FROM tmsk_dtl WHERE mskd_nomor = ?', [nomor]);
        await connection.query('DELETE FROM tmsk_hdr WHERE msk_nomor = ?', [nomor]);

        await connection.commit();
        return { message: `Dokumen ${nomor} berhasil dihapus.` };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};


module.exports = {
    getCabangList,
    getList,
    getDetails,
    remove,
};
