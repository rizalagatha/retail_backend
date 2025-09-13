const pool = require('../config/database');

const getNextBarcodeNumber = async (cabang, tanggal) => {
    // Meniru logika getmaxnomor dari Delphi
    const prefix = `${cabang}BCD${tanggal.substring(2, 4)}${tanggal.substring(5, 7)}`;
    const query = `
        SELECT IFNULL(MAX(RIGHT(bch_nomor, 5)), 0) as lastNum 
        FROM tbarcode_hdr 
        WHERE LEFT(bch_nomor, 10) = ?
    `;
    const [rows] = await pool.query(query, [prefix]);
    const lastNum = parseInt(rows[0].lastNum, 10);
    const newNum = (lastNum + 1).toString().padStart(5, '0');
    return `${prefix}${newNum}`;
};

const searchProducts = async (term, category, gudang, page, itemsPerPage) => {
    const offset = (page - 1) * itemsPerPage;
    const searchTerm = `%${term}%`;
    let params = [];
    
    // Base query untuk menggabungkan tabel master dan detail barang
    let fromClause = `
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
    `;

    // Filter
    let whereClause = 'WHERE a.brg_logstok="Y" AND a.brg_aktif=0';
    
    // Filter kategori
    if (category === 'Kaosan') {
        whereClause += ' AND (a.brg_ktg IS NULL OR a.brg_ktg = "")';
    } else { // Asumsi selain Kaosan adalah Reszo
        whereClause += ' AND a.brg_ktg IS NOT NULL AND a.brg_ktg <> ""';
    }

    // Filter pencarian (mencari di kode, nama, atau barcode)
    if (term) {
        whereClause += ` AND (
                        a.brg_kode LIKE ? 
                        OR TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) LIKE ?
                        OR b.brgd_barcode LIKE ?
                        )`;
        params.push(searchTerm, searchTerm, searchTerm);
    }
    
    const baseQuery = `${fromClause} ${whereClause}`;

    // Query untuk menghitung total
    const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;
    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0].total;

    // Query untuk mengambil data per halaman, lengkap dengan kalkulasi stok
    const dataQuery = `
        SELECT 
            a.brg_kode AS kode,
            b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            b.brgd_harga AS harga,
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                FROM tmasterstok m 
                WHERE m.mst_aktif = "Y" 
                AND m.mst_cab = ? 
                AND m.mst_brg_kode = b.brgd_kode 
                AND m.mst_ukuran = b.brgd_ukuran
            ), 0) AS stok
        ${baseQuery}
        ORDER BY nama, b.brgd_barcode
        LIMIT ? OFFSET ?
    `;
    // Tambahkan 'gudang' di awal parameter untuk kalkulasi stok
    const dataParams = [gudang, ...params, itemsPerPage, offset];
    const [items] = await pool.query(dataQuery, dataParams);

    return { items, total };
};

const getProductDetails = async (productCode) => {
    // Mengambil detail ukuran dan barcode untuk produk yang dipilih
     const query = `
        SELECT 
            b.brgd_kode as kode,
            b.brgd_barcode as barcode,
            b.brgd_ukuran as ukuran,
            b.brgd_harga as harga,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
        WHERE b.brgd_kode = ?
    `;
    const [rows] = await pool.query(query, [productCode]);
    return rows;
};


const saveBarcode = async (data) => {
    const { header, details, user } = data;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Simpan Header
        await connection.query(
            'INSERT INTO tbarcode_hdr (bch_nomor, bch_tanggal, user_create, date_create) VALUES (?, ?, ?, NOW())',
            [header.nomor, header.tanggal, user.kode]
        );

        // 2. Simpan Detail
        for (const [index, detail] of details.entries()) {
            if (detail.kode && detail.jumlah > 0) {
                await connection.query(
                    'INSERT INTO tbarcode_dtl (bcd_nomor, bcd_kode, bcd_ukuran, bcd_jumlah, bcd_nourut) VALUES (?, ?, ?, ?, ?)',
                    [header.nomor, detail.kode, detail.ukuran, detail.jumlah, index + 1]
                );
            }
        }

        await connection.commit();
        return { success: true, message: `Data barcode ${header.nomor} berhasil disimpan.` };
    } catch (error) {
        await connection.rollback();
        console.error("Error saving barcode:", error);
        throw new Error('Gagal menyimpan data barcode.');
    } finally {
        connection.release();
    }
};


module.exports = {
    getNextBarcodeNumber,
    searchProducts,
    getProductDetails,
    saveBarcode,
};
