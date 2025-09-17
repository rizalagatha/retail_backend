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
 * Mengambil detail item dari "Terima RB" atau "Permintaan"
 */
const getItemsForLoad = async (nomor, gudang) => {
    let query = '';
    const params = [gudang, nomor];

    // Cek apakah nomor adalah Terima RB atau Permintaan
    if (nomor.includes('RB')) {
        query = `
            SELECT 
                d.rbd_kode AS kode,
                b.brgd_barcode AS barcode,
                TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
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
    } else { // Asumsi lainnya adalah Nomor Permintaan
        query = `
            SELECT
                d.mtd_kode AS kode,
                b.brgd_barcode AS barcode,
                TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
                d.mtd_ukuran AS ukuran,
                d.mtd_jumlah AS minta, 
                IFNULL(b.brgd_min, 0) AS minstok, 
                IFNULL(b.brgd_max, 0) AS maxstok, 
                IFNULL((
                    SELECT SUM(sjd.sjd_jumlah) FROM tdc_sj_dtl sjd
                    JOIN tdc_sj_hdr sjh ON sjd.sjd_nomor = sjh.sj_nomor
                    WHERE sjh.sj_mt_nomor = d.mtd_nomor AND sjd.sjd_kode = d.mtd_kode AND sjd.sjd_ukuran = d.mtd_ukuran
                ), 0) AS sudah,
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

        // --- VALIDASI ---
        if (!header.gudang?.kode) throw new Error('Gudang harus diisi.');
        if (!header.store?.kode) throw new Error('Store tujuan harus diisi.');
        if (items.length === 0) throw new Error('Detail barang harus diisi.');
        
        let totalQty = 0;
        for (const item of items) {
            if (item.jumlah > item.stok) {
                throw new Error(`Jumlah untuk barang ${item.nama} (${item.ukuran}) melebihi stok.`);
            }
            totalQty += item.jumlah;
        }
        if (totalQty <= 0) throw new Error('Total jumlah barang tidak boleh nol.');
        // --- AKHIR VALIDASI ---

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
        
        await connection.query('DELETE FROM tdc_sj_dtl WHERE sjd_nomor = ?', [sjNomor]);

        // --- PERBAIKAN DI SINI ---
        // 1. Ganti 'sjd_nourut' menjadi 'sjd_iddrec'
        const detailSql = `
            INSERT INTO tdc_sj_dtl (sjd_iddrec, sjd_nomor, sjd_kode, sjd_ukuran, sjd_jumlah)
            VALUES ?;
        `;

        // 2. Sesuaikan data yang akan di-insert
        const detailValues = items
            .filter(item => item.kode && item.jumlah > 0)
            .map((item, index) => {
                const nourut = index + 1;
                // Buat iddrec sesuai logika Delphi (Nomor + No Urut)
                const iddrec = `${sjNomor}${nourut}`; 
                return [iddrec, sjNomor, item.kode, item.ukuran, item.jumlah];
            });
        // --- AKHIR PERBAIKAN ---


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
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
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

const searchStores = async (term, page, itemsPerPage) => {
    const offset = (page - 1) * itemsPerPage;
    const searchTerm = `%${term || ''}%`;
    const params = [searchTerm, searchTerm];
    
    // Filter dari Delphi: gdg_dc = 0 (Store Biasa) atau 3 (Store Prioritas)
    const baseWhere = 'WHERE (gdg_dc = 0 OR gdg_dc = 3)';
    const searchWhere = `AND (gdg_kode LIKE ? OR gdg_nama LIKE ?)`;
    
    const countQuery = `SELECT COUNT(*) as total FROM tgudang ${baseWhere} ${searchWhere}`;
    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0].total;

    const dataQuery = `
        SELECT gdg_kode AS kode, gdg_nama AS nama 
        FROM tgudang 
        ${baseWhere} ${searchWhere}
        ORDER BY gdg_kode
        LIMIT ? OFFSET ?;
    `;
    const dataParams = [...params, itemsPerPage, offset];
    const [items] = await pool.query(dataQuery, dataParams);

    // Kembalikan dalam format objek yang benar
    return { items, total };
};

const searchPermintaan = async (term, page, itemsPerPage, storeKode) => {
    const offset = (page - 1) * itemsPerPage;
    const searchTerm = `%${term || ''}%`;
    const params = [storeKode, searchTerm, searchTerm, searchTerm, searchTerm];

    // Query dari Delphi
    const baseFrom = `
        FROM tmintabarang_hdr h
        WHERE LEFT(h.mt_nomor, 3) = ? 
          AND h.mt_nomor NOT IN (SELECT sj_mt_nomor FROM tdc_sj_hdr WHERE sj_mt_nomor <> "")
    `;
    const searchWhere = `AND (h.mt_nomor LIKE ? OR h.mt_tanggal LIKE ? OR h.mt_otomatis LIKE ? OR h.mt_ket LIKE ?)`;
    
    const countQuery = `SELECT COUNT(*) AS total ${baseFrom} ${searchWhere}`;
    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0].total;

    const dataQuery = `
        SELECT h.mt_nomor AS nomor, h.mt_tanggal AS tanggal, h.mt_otomatis AS otomatis, h.mt_ket AS keterangan
        ${baseFrom} ${searchWhere}
        ORDER BY h.date_create DESC
        LIMIT ? OFFSET ?;
    `;
    const dataParams = [...params, itemsPerPage, offset];
    const [items] = await pool.query(dataQuery, dataParams);
    
    return { items, total };
};

const searchTerimaRb = async (term, page, itemsPerPage, user) => {
    const offset = (page - 1) * itemsPerPage;
    const searchTerm = `%${term || ''}%`;
    const params = [user.cabang, searchTerm, searchTerm, searchTerm];

    const baseFrom = `
        FROM tdcrb_hdr h
        LEFT JOIN trbdc_hdr r ON r.rb_noterima = h.rb_nomor
        LEFT JOIN tgudang g ON g.gdg_kode = LEFT(r.rb_nomor, 3)
        WHERE LEFT(h.rb_nomor, 3) = ?
    `;
    const searchWhere = `AND (h.rb_nomor LIKE ? OR r.rb_nomor LIKE ? OR g.gdg_nama LIKE ?)`;
    
    const countQuery = `SELECT COUNT(*) AS total ${baseFrom} ${searchWhere}`;
    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0].total;

    const dataQuery = `
        SELECT h.rb_nomor AS nomor, h.rb_tanggal AS tanggal, 
               r.rb_nomor AS no_rb, r.rb_tanggal AS tgl_rb,
               CONCAT(LEFT(r.rb_nomor, 3), ' - ', g.gdg_nama) AS dari_store
        ${baseFrom} ${searchWhere}
        ORDER BY h.date_create DESC
        LIMIT ? OFFSET ?;
    `;
    const dataParams = [...params, itemsPerPage, offset];
    const [items] = await pool.query(dataQuery, dataParams);
    
    return { items, total };
};

const findByBarcode = async (barcode, gudang) => {
    const query = `
        SELECT
            d.brgd_barcode AS barcode,
            d.brgd_kode AS kode,
            TRIM(CONCAT(h.brg_jeniskaos, " ", h.brg_tipe, " ", h.brg_lengan, " ", h.brg_jeniskain, " ", h.brg_warna)) AS nama,
            d.brgd_ukuran AS ukuran,
            d.brgd_harga AS harga,
            
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                FROM tmasterstok m 
                WHERE m.mst_aktif = 'Y' 
                  AND m.mst_cab = ? 
                  AND m.mst_brg_kode = d.brgd_kode 
                  AND m.mst_ukuran = d.brgd_ukuran
            ), 0) AS stok

        FROM tbarangdc_dtl d
        LEFT JOIN tbarangdc h ON h.brg_kode = d.brgd_kode
        WHERE h.brg_aktif = 0 
          AND d.brgd_barcode = ?;
    `;
    
    // Parameter 'gudang' sekarang digunakan untuk subquery stok
    const [rows] = await pool.query(query, [gudang, barcode]);
    
    if (rows.length === 0) {
        throw new Error('Barcode tidak ditemukan atau barang tidak aktif.');
    }
    return rows[0];
};

module.exports = {
    getItemsForLoad,
    saveData,
    loadForEdit,
    searchStores,
    searchPermintaan,
    searchTerimaRb,
    findByBarcode,
};
