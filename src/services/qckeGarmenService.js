const pool = require('../config/database');

/**
 * Mengambil data master QC berdasarkan rentang tanggal.
 */
const getQCMaster = async (startDate, endDate) => {
    // Query Master dari kode Delphi Anda
    const query = `
        SELECT
            x.Nomor, x.Tanggal, x.NamaGudang, x.Keterangan, x.Kirim, x.Terima,
            IF(x.terima >= x.kirim AND x.terima <> 0, "Y", "N") AS \`Close\`,
            x.Usr, x.Modified, x.Closing
        FROM (
            SELECT
                h.mut_nomor AS Nomor, h.mut_tanggal AS Tanggal, g.gdg_nama AS NamaGudang,
                h.mut_ket AS Keterangan,
                IFNULL((SELECT SUM(i.mutd_jumlah) FROM tdc_qc_dtl i WHERE i.mutd_nomor = h.mut_nomor), 0) AS kirim,
                IFNULL((SELECT SUM(i.mutd_jumlah) FROM tdc_qc_dtl2 i WHERE i.mutd_nomor = h.mut_nomor), 0) AS terima,
                h.user_create AS Usr, h.user_modified AS Modified, h.mut_closing AS Closing
            FROM tdc_qc_hdr h
            LEFT JOIN kencanaprint.tgudang g ON g.gdg_kode = h.mut_kecab
            WHERE h.mut_tanggal BETWEEN ? AND ?
            ORDER BY h.mut_tanggal
        ) x;
    `;
    const params = [startDate, endDate];

    try {
        const [rows] = await pool.query(query, params);
        return rows;
    } catch (error) {
        console.error("SQL Error in getQCMaster:", error.message);
        throw error;
    }
};

/**
 * Mengambil data detail QC berdasarkan nomor master.
 */
const getQCDetailsByNomor = async (nomor) => {
    // Query Detail dari kode Delphi Anda, diadaptasi untuk satu nomor
    const query = `
        SELECT
            h.mut_nomor AS Nomor, d.mutd_kode AS Kode,
            CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna) AS Nama,
            d.mutd_ukuran AS Ukuran, d.mutd_jumlah AS Jumlah,
            IFNULL((
                SELECT SUM(i.mutd_jumlah) FROM tdc_qc_dtl2 i
                WHERE i.mutd_nomor = h.mut_nomor
                  AND i.mutd_kodelama = d.mutd_kode
                  AND i.mutd_ukuranlama = d.mutd_ukuran
            ), 0) AS SudahTerima
        FROM tdc_qc_dtl d
        INNER JOIN tdc_qc_hdr h ON d.mutd_nomor = h.mut_nomor
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.mutd_kode
        WHERE h.mut_nomor = ?
        ORDER BY d.mutd_nomor;
    `;
    const params = [nomor];

    try {
        const [rows] = await pool.query(query, params);
        return rows;
    } catch (error) {
        console.error("SQL Error in getQCDetailsByNomor:", error.message);
        throw error;
    }
};

/**
 * Menghapus data QC (header dan detail) dalam satu transaksi.
 */
const deleteQC = async (nomor) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Hapus dari tabel-tabel detail terlebih dahulu untuk menjaga integritas data
        await connection.query('DELETE FROM tdc_qc_dtl WHERE mutd_nomor = ?', [nomor]);
        await connection.query('DELETE FROM tdc_qc_dtl2 WHERE mutd_nomor = ?', [nomor]);
        
        // Hapus dari tabel header
        const [result] = await connection.query('DELETE FROM tdc_qc_hdr WHERE mut_nomor = ?', [nomor]);

        if (result.affectedRows === 0) {
            throw new Error(`Data QC dengan nomor ${nomor} tidak ditemukan.`);
        }
        
        await connection.commit();
        return { success: true, message: `Data QC ${nomor} berhasil dihapus.` };
    } catch (error) {
        await connection.rollback();
        console.error("Transaction Error in deleteQC:", error.message);
        throw error; // Lempar error agar controller bisa menangkapnya
    } finally {
        connection.release();
    }
};

module.exports = {
    getQCMaster,
    getQCDetailsByNomor,
    deleteQC,
};