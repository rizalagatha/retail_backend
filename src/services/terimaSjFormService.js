const pool = require('../config/database');
const { format } = require('date-fns'); // Pastikan import ini ada di paling atas

/**
 * Menghasilkan nomor Terima SJ (TJ) baru.
 */
const generateNewTjNumber = async (gudang, tanggal) => {
    const date = new Date(tanggal);
    const prefix = `${gudang}.TJ.${format(date, 'yyMM')}.`;
    
    const query = `
        SELECT IFNULL(MAX(RIGHT(tj_nomor, 4)), 0) + 1 AS next_num
        FROM ttrm_sj_hdr 
        WHERE tj_nomor LIKE ?;
    `;
    const [rows] = await pool.query(query, [`${prefix}%`]);
    const nextNumber = rows[0].next_num.toString().padStart(4, '0');
    
    return `${prefix}${nextNumber}`;
};

/**
 * Memuat data awal untuk form dari Surat Jalan yang dipilih.
 */
const loadInitialData = async (nomorSj) => {
    const headerQuery = `
        SELECT 
            h.sj_nomor, h.sj_tanggal, h.sj_mt_nomor, h.sj_ket AS keterangan,
            LEFT(h.sj_nomor, 3) AS gudang_asal_kode,
            g_asal.gdg_nama AS gudang_asal_nama
        FROM tdc_sj_hdr h
        LEFT JOIN tgudang g_asal ON g_asal.gdg_kode = LEFT(h.sj_nomor, 3)
        WHERE h.sj_nomor = ?;
    `;
    const [headerRows] = await pool.query(headerQuery, [nomorSj]);
    if (headerRows.length === 0) throw new Error('Data Surat Jalan tidak ditemukan.');

    const itemsQuery = `
        SELECT
            d.sjd_kode AS kode,
            b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d.sjd_ukuran AS ukuran,
            d.sjd_jumlah AS jumlahKirim
        FROM tdc_sj_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.sjd_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sjd_kode AND b.brgd_ukuran = d.sjd_ukuran
        WHERE d.sjd_nomor = ?
        ORDER BY d.sjd_kode, d.sjd_ukuran;
    `;
    const [items] = await pool.query(itemsQuery, [nomorSj]);

    return { header: headerRows[0], items };
};

/**
 * Menyimpan data Terima SJ.
 */
const saveData = async (payload, user) => {
    const { header, items } = payload;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        if (items.some(item => item.jumlahTerima > item.jumlahKirim)) {
            throw new Error('Jumlah terima tidak boleh melebihi jumlah kirim.');
        }

        const tjNomor = await generateNewTjNumber(user.cabang, header.tanggalTerima);

        // Generate `idrec` untuk header, sesuai logika Delphi
        const timestamp = format(new Date(), 'yyyyMMddHHmmssSSS');
        const idrec = `${user.cabang}TJ${timestamp}`;

        // Insert ke header penerimaan (ttrm_sj_hdr)
        const headerSql = `
            INSERT INTO ttrm_sj_hdr (tj_idrec, tj_nomor, tj_tanggal, tj_mt_nomor, user_create, date_create)
            VALUES (?, ?, ?, ?, ?, NOW());
        `;
        await connection.query(headerSql, [idrec, tjNomor, header.tanggalTerima, header.nomorMinta, user.kode]);

        // Hapus detail lama (jika ada, untuk kasus edit di masa depan)
        await connection.query('DELETE FROM ttrm_sj_dtl WHERE tjd_nomor = ?', [tjNomor]);

        // Insert ke detail penerimaan (ttrm_sj_dtl)
        const detailSql = `
            INSERT INTO ttrm_sj_dtl (tjd_idrec, tjd_iddrec, tjd_nomor, tjd_kode, tjd_ukuran, tjd_jumlah) 
            VALUES ?;
        `;
        
        const detailValues = items
            .filter(item => item.jumlahTerima > 0)
            .map((item, index) => {
                const nourut = index + 1;
                const iddrec = `${idrec}${nourut}`;
                return [idrec, iddrec, tjNomor, item.kode, item.ukuran, item.jumlahTerima];
            });
        
        if (detailValues.length > 0) {
            await connection.query(detailSql, [detailValues]);
        }
        
        // Update nomor terima di Surat Jalan header (tdc_sj_hdr)
        const updateSjSql = 'UPDATE tdc_sj_hdr SET sj_noterima = ? WHERE sj_nomor = ?';
        await connection.query(updateSjSql, [tjNomor, header.nomorSj]);

        await connection.commit();
        return { message: `Penerimaan SJ berhasil disimpan dengan nomor ${tjNomor}.`, nomor: tjNomor };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = {
    loadInitialData,
    saveData,
};