const pool = require('../config/database');
const { format } = require("date-fns");

/**
 * Mengambil daftar tanggal stok opname yang sudah di-setting untuk cabang user.
 */
const getList = async (user) => {
    const query = `
        SELECT 
            st_cab AS cabang,
            st_tanggal AS tanggal,
            st_transfer AS transfer
        FROM tsop_tanggal 
        WHERE st_cab = ? 
        ORDER BY st_tanggal
    `;
    const [rows] = await pool.query(query, [user.cabang]);
    return rows;
};

/**
 * Menetapkan tanggal stok opname baru.
 */
const setDate = async (tanggal, user) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Validasi dari Delphi (btnOkClick): Cek apakah sudah ada tanggal yang belum ditransfer.
        const [existing] = await connection.query(
            "SELECT 1 FROM tsop_tanggal WHERE st_transfer = 'N' AND st_cab = ? LIMIT 1",
            [user.cabang]
        );
        if (existing.length > 0) {
            throw new Error('Sudah ada tanggal stok opname yang aktif (belum ditransfer). Selesaikan atau hapus terlebih dahulu.');
        }

        // Insert tanggal baru
        await connection.query(
            'INSERT INTO tsop_tanggal (st_cab, st_tanggal) VALUES (?, ?)',
            [user.cabang, tanggal]
        );

        await connection.commit();
        return { message: `Tanggal stok opname ${format(new Date(tanggal), 'dd-MM-yyyy')} berhasil disetting.` };
    } catch (error) {
        await connection.rollback();
        throw error; // Lempar error ke controller
    } finally {
        connection.release();
    }
};

/**
 * Menghapus tanggal stok opname.
 */
const deleteDate = async (tanggal, user) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        // Ambil data untuk validasi
        const [rows] = await connection.query(
            'SELECT st_transfer FROM tsop_tanggal WHERE st_cab = ? AND st_tanggal = ?',
            [user.cabang, tanggal]
        );
        if (rows.length === 0) throw new Error("Data tanggal tidak ditemukan.");
        
        // Validasi dari Delphi (cxButton4Click): Cek apakah sudah ditransfer.
        if (rows[0].st_transfer === 'Y') {
            throw new Error('Tanggal ini sudah ditransfer dan tidak bisa dihapus.');
        }
        
        // Lakukan penghapusan
        await connection.query(
            'DELETE FROM tsop_tanggal WHERE st_cab = ? AND st_tanggal = ?',
            [user.cabang, tanggal]
        );
        
        await connection.commit();
        return { message: `Tanggal stok opname berhasil dihapus.` };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = {
    getList,
    setDate,
    deleteDate,
};