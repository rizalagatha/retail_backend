const pool = require('../config/database');

/**
 * Menghasilkan nomor Surat Jalan (SJ) baru.
 * Format: KDC.SJ.YYMM.NNNN
 */
const generateNewSjNumber = async (gudang, tanggal) => {
    const [year, month] = tanggal.split('-');
    const prefix = `${gudang}.SJ.${year.substring(2)}${month}.`;
    
    const query = `
        SELECT IFNULL(MAX(RIGHT(sj_nomor, 4)), 0) + 1 AS next_num
        FROM tdc_sj_hdr 
        WHERE sj_nomor LIKE ?;
    `;
    const [rows] = await pool.query(query, [`${prefix}%`]);
    const nextNumber = rows[0].next_num.toString().padStart(4, '0');
    
    return `${prefix}${nextNumber}`;
};

/**
 * Mengambil data untuk lookup (F1)
 */
const getLookupData = async (type, user, filter) => {
    let query = '';
    const params = [];
    
    switch (type) {
        case 'gudang':
            query = 'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc=1 ORDER BY gdg_kode';
            break;
        case 'store':
            query = 'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc IN (0, 3) ORDER BY gdg_kode';
            break;
        case 'permintaan':
            if (!filter.store) throw new Error('Store harus dipilih untuk mencari No. Permintaan');
            query = `
                SELECT h.mt_nomor AS nomor, h.mt_tanggal AS tanggal, h.mt_ket AS keterangan
                FROM tmintabarang_hdr h
                WHERE LEFT(h.mt_nomor, 3) = ? 
                  AND h.mt_nomor NOT IN (SELECT sj_mt_nomor FROM tdc_sj_hdr WHERE sj_mt_nomor <> "")
                ORDER BY h.date_create DESC;
            `;
            params.push(filter.store);
            break;
        case 'terima-rb':
             query = `
                SELECT h.rb_nomor AS nomor, h.rb_tanggal AS tanggal, 
                       CONCAT(LEFT(r.rb_nomor,3), ' - ', g.gdg_nama) AS dari_store
                FROM tdcrb_hdr h
                LEFT JOIN trbdc_hdr r ON r.rb_noterima = h.rb_nomor
                LEFT JOIN tgudang g ON g.gdg_kode = LEFT(r.rb_nomor, 3)
                WHERE LEFT(h.rb_nomor, 3) = ?
                ORDER BY h.date_create DESC LIMIT 100;
            `;
            params.push(user.cabang);
            break;
        default:
            throw new Error('Tipe lookup tidak valid.');
    }

    const [rows] = await pool.query(query, params);
    return rows;
};

/**
 * Mengambil detail item dari "Terima RB" atau "Permintaan"
 */
const getItemsForLoad = async (nomor, gudang) => {
    let query = '';
    const params = [gudang, nomor];

    if (nomor.includes('RB')) { // Berdasarkan nomor Terima RB
        query = `
            SELECT 
                d.rbd_kode AS kode,
                b.brgd_barcode AS barcode,
                TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe)) AS nama,
                d.rbd_ukuran AS ukuran,
                d.rbd_jumlah AS jumlah,
                IFNULL((
                    SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m 
                    WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=d.rbd_kode AND m.mst_ukuran=d.rbd_ukuran
                ), 0) AS stok
            FROM tdcrb_dtl d
            LEFT JOIN tbarangdc a ON a.brg_kode = d.rbd_kode
            LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.rbd_kode AND b.brgd_ukuran = d.rbd_ukuran
            WHERE d.rbd_nomor = ?;
        `;
    } else { // Berdasarkan nomor Permintaan
        query = `
            SELECT
                d.mtd_kode AS kode,
                b.brgd_barcode AS barcode,
                TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe)) AS nama,
                d.mtd_ukuran AS ukuran,
                d.mtd_jumlah AS jumlah,
                IFNULL((
                    SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m 
                    WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=d.mtd_kode AND m.mst_ukuran=d.mtd_ukuran
                ), 0) AS stok
            FROM tmintabarang_dtl d
            LEFT JOIN tbarangdc a ON a.brg_kode = d.mtd_kode
            LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.mtd_kode AND b.brgd_ukuran = d.mtd_ukuran
            WHERE d.mtd_nomor = ?;
        `;
    }

    const [rows] = await pool.query(query, params);
    return rows;
};


/**
 * Menyimpan data Surat Jalan (Baru atau Ubah).
 */
const saveData = async (payload, user) => {
    const { header, items, isNew } = payload;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        let sjNomor = header.nomor;

        if (isNew) {
            sjNomor = await generateNewSjNumber(header.gudang.kode, header.tanggal);
            const headerSql = `
                INSERT INTO tdc_sj_hdr (sj_nomor, sj_tanggal, sj_kecab, sj_mt_nomor, sj_ket, user_create, date_create)
                VALUES (?, ?, ?, ?, ?, ?, NOW());
            `;
            await connection.query(headerSql, [sjNomor, header.tanggal, header.store.kode, header.permintaan, header.keterangan, user.kode]);
        } else {
            const headerSql = `
                UPDATE tdc_sj_hdr SET sj_tanggal = ?, sj_kecab = ?, sj_ket = ?, user_modified = ?, date_modified = NOW()
                WHERE sj_nomor = ?;
            `;
            await connection.query(headerSql, [header.tanggal, header.store.kode, header.keterangan, user.kode, sjNomor]);
        }
        
        // Hapus detail lama dan insert yang baru
        await connection.query('DELETE FROM tdc_sj_dtl WHERE sjd_nomor = ?', [sjNomor]);

        const detailSql = `
            INSERT INTO tdc_sj_dtl (sjd_nomor, sjd_kode, sjd_ukuran, sjd_jumlah, sjd_nourut)
            VALUES ?;
        `;
        const detailValues = items
            .filter(item => item.kode && item.jumlah > 0)
            .map((item, index) => [sjNomor, item.kode, item.ukuran, item.jumlah, index + 1]);

        if (detailValues.length > 0) {
            await connection.query(detailSql, [detailValues]);
        }

        await connection.commit();
        return { message: `Surat Jalan ${sjNomor} berhasil disimpan.`, nomor: sjNomor };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

/**
 * Memuat data SJ untuk mode Ubah.
 */
const loadForEdit = async (nomor, user) => {
    const headerQuery = `
        SELECT 
            h.sj_nomor AS nomor,
            h.sj_tanggal AS tanggal,
            h.sj_ket AS keterangan,
            h.sj_mt_nomor AS permintaan,
            LEFT(h.sj_nomor, 3) AS gudang_kode,
            g.gdg_nama AS gudang_nama,
            h.sj_kecab AS store_kode,
            s.gdg_nama AS store_nama
        FROM tdc_sj_hdr h
        LEFT JOIN tgudang g ON g.gdg_kode = LEFT(h.sj_nomor, 3)
        LEFT JOIN tgudang s ON s.gdg_kode = h.sj_kecab
        WHERE h.sj_nomor = ?;
    `;
    const [headerRows] = await pool.query(headerQuery, [nomor]);
    if (headerRows.length === 0) throw new Error('Data tidak ditemukan');
    
    const itemsQuery = `
        SELECT
            d.sjd_kode AS kode,
            b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe)) AS nama,
            d.sjd_ukuran AS ukuran,
            d.sjd_jumlah AS jumlah,
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m 
                WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=d.sjd_kode AND m.mst_ukuran=d.sjd_ukuran
            ), 0) AS stok
        FROM tdc_sj_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.sjd_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sjd_kode AND b.brgd_ukuran = d.sjd_ukuran
        WHERE d.sjd_nomor = ?;
    `;
    const [items] = await pool.query(itemsQuery, [user.cabang, nomor]);
    
    return { header: headerRows[0], items };
};

const searchStore = async (term, page, itemsPerPage) => {
    const offset = (page - 1) * itemsPerPage;
    const searchTerm = `%${term || ''}%`;
    const params = [searchTerm, searchTerm];
    
    // Filter dari Delphi: gdg_dc = 0 (Store Biasa) atau 3 (Store Prioritas)
    const baseWhere = 'WHERE (gdg_dc = 0 OR gdg_dc = 3)';
    const searchWhere = `AND (gdg_kode LIKE ? OR gdg_nama LIKE ?)`;
    
    // Query untuk menghitung total item
    const countQuery = `SELECT COUNT(*) as total FROM tgudang ${baseWhere} ${searchWhere}`;
    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0].total;

    // Query untuk mengambil data per halaman
    const dataQuery = `
        SELECT gdg_kode AS kode, gdg_nama AS nama 
        FROM tgudang 
        ${baseWhere} ${searchWhere}
        ORDER BY gdg_kode
        LIMIT ? OFFSET ?;
    `;
    const dataParams = [...params, itemsPerPage, offset];
    const [items] = await pool.query(dataQuery, dataParams);

    return { items, total };
};

module.exports = {
    getLookupData,
    getItemsForLoad,
    saveData,
    loadForEdit,
    searchStore,
};
