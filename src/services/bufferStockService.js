const pool = require('../config/database');

/**
 * Fungsi untuk mengambil nilai buffer dari tabel tbuffer.
 * Direplikasi dari fungsi getbuffer di Delphi.
 */
const getBufferValue = async (cab, bf, warna, lengan, ukuran) => {
    let query;
    const params = [cab, warna, ukuran];

    if (warna === 'WARNA') {
        query = 'SELECT * FROM tbuffer WHERE bf_cab=? AND bf_warna=? AND bf_lengan="" AND bf_ukuran=?';
    } else {
        query = 'SELECT * FROM tbuffer WHERE bf_cab=? AND bf_warna=? AND bf_lengan=? AND bf_ukuran=?';
        params.splice(2, 0, lengan); // Sisipkan lengan ke parameter
    }

    const [rows] = await pool.query(query, params);
    if (rows.length > 0) {
        return bf === 'MIN' ? rows[0].bf_buffer_min : rows[0].bf_buffer_max;
    }
    return 0;
};

/**
 * Service utama untuk mengupdate buffer stok.
 * @param {boolean} updateDc - Apakah akan mengupdate buffer DC.
 * @param {boolean} updateStore - Apakah akan mengupdate buffer Store.
 */
const updateBufferStock = async (updateDc, updateStore) => {
    const connection = await pool.getConnection(); // Gunakan transaksi
    try {
        await connection.beginTransaction();

        // 1. Reset semua buffer ke 0
        const resetQuery = `
            UPDATE tbarangdc_dtl SET 
            brgd_min=0, brgd_max=0, brgd_mindc=0, brgd_maxdc=0
        `;
        await connection.query(resetQuery);

        // 2. Ambil semua barang yang relevan
        const selectProductsQuery = `
            SELECT a.brg_kode, b.brgd_ukuran, a.brg_lengan, a.brg_warna
            FROM tbarangdc a
            INNER JOIN tbarangdc_dtl b ON b.brgd_kode=a.brg_kode AND b.brgd_ukuran IN (SELECT DISTINCT bf_ukuran FROM tbuffer)
            WHERE a.brg_aktif=0 AND a.brg_otomatis=0 AND a.brg_logstok="Y" AND a.brg_ktg="" AND a.brg_ktgp="REGULER"
            AND ((a.brg_lengan LIKE "%PANJANG%") OR (a.brg_lengan LIKE "%PENDEK%"))
            ORDER BY a.brg_kode
        `;
        const [products] = await connection.query(selectProductsQuery);

        // 3. Loop melalui setiap produk dan update buffer-nya
        for (const product of products) {
            let lengan = '';
            if (product.brg_lengan.includes('PENDEK')) lengan = 'PENDEK';
            else if (product.brg_lengan.includes('PANJANG')) lengan = 'PANJANG';

            let warna = 'WARNA';
            if (product.brg_warna === 'HITAM') warna = 'HITAM';
            else if (['PUTIH', 'PUTIH TULANG'].includes(product.brg_warna)) warna = 'PUTIH';

            const minStore = await getBufferValue('STORE', 'MIN', warna, lengan, product.brgd_ukuran);
            const maxStore = await getBufferValue('STORE', 'MAX', warna, lengan, product.brgd_ukuran);
            const minDc = await getBufferValue('DC', 'MIN', warna, lengan, product.brgd_ukuran);
            const maxDc = await getBufferValue('DC', 'MAX', warna, lengan, product.brgd_ukuran);

            let updateQuery = 'UPDATE tbarangdc_dtl SET ';
            const updates = [];
            if (updateStore) {
                updates.push(`brgd_min = ${minStore}`, `brgd_max = ${maxStore}`);
            }
            if (updateDc) {
                updates.push(`brgd_mindc = ${minDc}`, `brgd_maxdc = ${maxDc}`);
            }
            
            if (updates.length > 0) {
                updateQuery += updates.join(', ');
                updateQuery += ` WHERE brgd_kode = ? AND brgd_ukuran = ?`;
                await connection.query(updateQuery, [product.brg_kode, product.brgd_ukuran]);
            }
        }

        await connection.commit(); // Jika semua berhasil, commit transaksi
        return { success: true, message: 'Update Buffer Stok Selesai.' };

    } catch (error) {
        await connection.rollback(); // Jika ada error, batalkan semua perubahan
        console.error("Error during buffer stock update:", error);
        throw new Error('Gagal mengupdate buffer stok.');
    } finally {
        connection.release(); // Selalu lepaskan koneksi
    }
};

module.exports = {
    updateBufferStock,
};
