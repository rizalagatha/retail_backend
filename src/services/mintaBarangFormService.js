const pool = require('../config/database');
const { format } = require('date-fns');

const getSudah = async (connection, soNomor, kode, ukuran, excludeMtNomor) => {
    const query = `
        SELECT IFNULL(SUM(mtd_jumlah), 0) AS total 
        FROM tmintabarang_dtl
        JOIN tmintabarang_hdr ON mt_nomor = mtd_nomor
        WHERE mt_nomor <> ? AND mt_so = ? AND mtd_kode = ? AND mtd_ukuran = ?
    `;
    const [rows] = await connection.query(query, [excludeMtNomor || '', soNomor, kode, ukuran]);
    return rows[0].total;
};

const getSoDetailsForGrid = async (soNomor, user) => {
    const connection = await pool.getConnection();
    try {
        const query = `
            SELECT 
                d.sod_kode AS kode, 
                IFNULL(b.brgd_barcode, '') AS barcode,
                IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), d.sod_kode) AS nama,
                d.sod_ukuran AS ukuran,
                IFNULL(b.brgd_min, 0) AS stokmin,
                IFNULL(b.brgd_max, 0) AS stokmax,
                IFNULL((
                    SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                    FROM tmasterstok m 
                    WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=d.sod_kode AND m.mst_ukuran=d.sod_ukuran
                ), 0) AS stok,
                d.sod_jumlah AS qtyso,
                c.cus_kode, c.cus_nama, c.cus_alamat
            FROM tso_dtl d
            JOIN tso_hdr h ON d.sod_so_nomor = h.so_nomor
            LEFT JOIN tbarangdc a ON a.brg_kode = d.sod_kode AND a.brg_logstok="Y"
            LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sod_kode AND b.brgd_ukuran = d.sod_ukuran
            LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
            WHERE h.so_aktif = "Y" AND h.so_nomor = ?
            ORDER BY d.sod_nourut
        `;
        const [rows] = await connection.query(query, [user.cabang, soNomor]);

        const customerData = rows.length > 0 ? {
            kode: rows[0].cus_kode,
            nama: rows[0].cus_nama,
            alamat: rows[0].cus_alamat
        } : null;
        
        const items = [];
        for (const row of rows) {
            const sudah = await getSudah(connection, soNomor, row.kode, row.ukuran, '');
            items.push({
                kode: row.kode,
                barcode: row.barcode,
                nama: row.nama,
                ukuran: row.ukuran,
                stok: row.stok,
                qtyso: row.qtyso,
                stokmin: row.stokmin,
                stokmax: row.stokmax,
                sudah: sudah,
                belum: row.qtyso - sudah,
                jumlah: 0,
            });
        }
        return { items, customer: customerData };
    } finally {
        connection.release();
    }
};

const getProductDetailsForGrid = async (filters, user) => {
    const { kode, ukuran, barcode } = filters;
    const connection = await pool.getConnection();
    try {
        let query = `
            SELECT 
                b.brgd_kode AS kode,
                b.brgd_barcode AS barcode,
                IFNULL(TRIM(CONCAT(
                    a.brg_jeniskaos, " ", a.brg_tipe, " ",
                    a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna
                )), '') AS nama,
                b.brgd_ukuran AS ukuran,
                IFNULL(b.brgd_min, 0) AS stokmin,
                IFNULL(b.brgd_max, 0) AS stokmax,
                IFNULL((
                    SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                    FROM tmasterstok m 
                    WHERE m.mst_aktif="Y" AND m.mst_cab=? 
                      AND m.mst_brg_kode=b.brgd_kode AND m.mst_ukuran=b.brgd_ukuran
                ), 0) AS stok,
                IFNULL((
                    SELECT SUM(mtd.mtd_jumlah) 
                    FROM tmintabarang_hdr mth 
                    JOIN tmintabarang_dtl mtd ON mtd.mtd_nomor = mth.mt_nomor 
                    WHERE mth.mt_closing='N' 
                      AND LEFT(mth.mt_nomor,3)=? 
                      AND mtd.mtd_kode=b.brgd_kode 
                      AND mtd.mtd_ukuran=b.brgd_ukuran 
                      AND mth.mt_nomor NOT IN (
                          SELECT sj_mt_nomor FROM tdc_sj_hdr WHERE sj_mt_nomor<>""
                      )
                ), 0) AS sudahminta,
                IFNULL((
                    SELECT SUM(sjd.sjd_jumlah) 
                    FROM tdc_sj_hdr sjh 
                    JOIN tdc_sj_dtl sjd ON sjd.sjd_nomor=sjh.sj_nomor 
                    WHERE sjh.sj_kecab=? AND sjh.sj_noterima='' 
                      AND sjd.sjd_kode=b.brgd_kode 
                      AND sjd.sjd_ukuran=b.brgd_ukuran
                ), 0) AS sj
            FROM tbarangdc_dtl b
            JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
            WHERE a.brg_logstok = "Y"
        `;

        const params = [user.cabang, user.cabang, user.cabang];

        if (barcode) {
            query += ` AND b.brgd_barcode = ?`;
            params.push(barcode);
        } else {
            query += ` AND b.brgd_kode = ? AND b.brgd_ukuran = ?`;
            params.push(kode, ukuran);
        }

        const [rows] = await connection.query(query, params);
        if (rows.length === 0) {
            throw new Error('Detail produk tidak ditemukan.');
        }

        const product = rows[0];
        const mino = product.stokmax - (product.stok + product.sudahminta + product.sj);
        product.mino = mino > 0 ? mino : 0;
        product.jumlah = product.mino;

        return product;
    } finally {
        connection.release();
    }
};


const getBufferStokItems = async (user) => { /* ... (Implementasi query dari btnRefreshClick PanelPSM) ... */ };

/**
 * @description Menyimpan data Minta Barang (baru atau ubah).
 */
const save = async (data, user) => {
    const { header, items, isNew } = data;
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        let mtNomor = header.nomor;
        let idrec;

        if (isNew) {
            // Logika getmaxnomor dari Delphi
            const prefix = `${user.cabang}MT${format(new Date(header.tanggal), 'yyMM')}`;
            const [maxRows] = await connection.query(`SELECT IFNULL(MAX(RIGHT(mt_nomor, 4)), 0) as maxNum FROM tmintabarang_hdr WHERE LEFT(mt_nomor, 9) = ?`, [prefix]);
            const nextNum = parseInt(maxRows[0].maxNum, 10) + 1;
            mtNomor = `${prefix}${String(10000 + nextNum).slice(1)}`;
            idrec = `${user.cabang}MT${format(new Date(), 'yyyyMMddHHmmssSSS')}`;

            const insertHeaderQuery = `
                INSERT INTO tmintabarang_hdr (mt_idrec, mt_nomor, mt_tanggal, mt_so, mt_cus, mt_ket, user_create, date_create) 
                VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
            `;
            await connection.query(insertHeaderQuery, [idrec, mtNomor, header.tanggal, header.soNomor, header.customer?.kode, header.keterangan, user.kode]);
        } else {
            const [idrecRows] = await connection.query('SELECT mt_idrec FROM tmintabarang_hdr WHERE mt_nomor = ?', [mtNomor]);
            if (idrecRows.length === 0) throw new Error('Nomor Minta Barang tidak ditemukan.');
            idrec = idrecRows[0].mt_idrec;

            const updateHeaderQuery = `
                UPDATE tmintabarang_hdr SET
                    mt_tanggal = ?, mt_so = ?, mt_cus = ?, mt_ket = ?,
                    user_modified = ?, date_modified = NOW()
                WHERE mt_nomor = ?
            `;
            await connection.query(updateHeaderQuery, [header.tanggal, header.soNomor, header.customer?.kode, header.keterangan, user.kode, mtNomor]);
        }

        // Pola "hapus-lalu-sisipkan" untuk detail
        await connection.query('DELETE FROM tmintabarang_dtl WHERE mtd_nomor = ?', [mtNomor]);

        const validItems = items.filter(item => item.kode && (item.jumlah || 0) > 0);
        for (const item of validItems) {
            await connection.query(
                'INSERT INTO tmintabarang_dtl (mtd_idrec, mtd_nomor, mtd_kode, mtd_ukuran, mtd_jumlah) VALUES (?, ?, ?, ?, ?)',
                [idrec, mtNomor, item.kode, item.ukuran, item.jumlah]
            );
        }

        await connection.commit();
        return { message: `Permintaan Barang ${mtNomor} berhasil disimpan.`, nomor: mtNomor };
    } catch (error) {
        await connection.rollback();
        console.error("Save Minta Barang Error:", error);
        throw new Error('Gagal menyimpan Permintaan Barang.');
    } finally {
        connection.release();
    }
};

const loadForEdit = async (nomor, user) => {
    const connection = await pool.getConnection();
    try {
        // Query ini adalah migrasi dari 'loaddataall' di Delphi
        const query = `
            SELECT 
                h.mt_nomor, h.mt_tanggal, h.mt_so, h.mt_cus, h.mt_ket,
                c.cus_nama, c.cus_alamat,
                d.mtd_kode, d.mtd_ukuran, d.mtd_jumlah,
                b.brgd_barcode, 
                IFNULL(b.brgd_min, 0) AS stokmin, 
                IFNULL(b.brgd_max, 0) AS stokmax,
                TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe)) AS nama,
                IFNULL((
                    SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m
                    WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=d.mtd_kode AND m.mst_ukuran=d.mtd_ukuran
                ), 0) AS stok,
                IFNULL((
                    SELECT SUM(prev_mtd.mtd_jumlah) FROM tmintabarang_hdr prev_mth
                    JOIN tmintabarang_dtl prev_mtd ON prev_mtd.mtd_nomor = prev_mth.mt_nomor
                    WHERE prev_mth.mt_closing='N' AND prev_mth.mt_nomor <> ? AND prev_mth.mt_so = h.mt_so
                      AND prev_mtd.mtd_kode = d.mtd_kode AND prev_mtd.mtd_ukuran = d.mtd_ukuran
                ), 0) AS sudahminta,
                IFNULL((
                    SELECT SUM(sjd.sjd_jumlah) FROM tdc_sj_hdr sjh
                    JOIN tdc_sj_dtl sjd ON sjd.sjd_nomor = sjh.sj_nomor
                    WHERE sjh.sj_kecab=? AND sjh.sj_noterima='' 
                      AND sjd.sjd_kode = d.mtd_kode AND sjd.sjd_ukuran = d.mtd_ukuran
                ), 0) AS sj
            FROM tmintabarang_hdr h
            LEFT JOIN tmintabarang_dtl d ON d.mtd_nomor = h.mt_nomor
            LEFT JOIN tbarangdc a ON a.brg_kode = d.mtd_kode
            LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.mtd_kode AND b.brgd_ukuran = d.mtd_ukuran
            LEFT JOIN tcustomer c ON c.cus_kode = h.mt_cus
            WHERE h.mt_nomor = ?
        `;
        const [rows] = await connection.query(query, [user.cabang, nomor, user.cabang, nomor]);
        if (rows.length === 0) {
            throw new Error('Data Permintaan Barang tidak ditemukan.');
        }

        // Proses dan format data untuk dikirim ke frontend
        const header = {
            nomor: rows[0].mt_nomor,
            tanggal: rows[0].mt_tanggal,
            soNomor: rows[0].mt_so,
            customer: {
                kode: rows[0].mt_cus,
                nama: rows[0].cus_nama,
                alamat: rows[0].cus_alamat,
            },
            keterangan: rows[0].mt_ket,
        };

        const items = rows.map(row => {
            const mino = row.stokmax - (row.stok + row.sudahminta + row.sj);
            return {
                kode: row.mtd_kode,
                nama: row.nama,
                ukuran: row.mtd_ukuran,
                stokmin: row.stokmin,
                stokmax: row.stokmax,
                sudahminta: row.sudahminta,
                sj: row.sj,
                stok: row.stok,
                mino: mino > 0 ? mino : 0,
                jumlah: row.mtd_jumlah,
                barcode: row.brgd_barcode,
            };
        });

        return { header, items };
    } finally {
        connection.release();
    }
};

module.exports = {
    getSoDetailsForGrid, 
    getBufferStokItems, 
    save, 
    loadForEdit,
    getProductDetailsForGrid,
};
