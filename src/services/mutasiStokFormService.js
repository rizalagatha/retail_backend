const pool = require('../config/database');
const { format } = require('date-fns');

/**
 * Menghasilkan nomor Mutasi Stok (MSO) baru.
 */
const generateNewMsoNumber = async (cabang, tanggal) => {
    const date = new Date(tanggal);
    const prefix = `${cabang}MSO${format(date, 'yyMM')}`;
    const query = `
        SELECT IFNULL(MAX(RIGHT(mso_nomor, 5)), 0) + 1 AS next_num
        FROM tmutasistok_hdr 
        WHERE mso_nomor LIKE ?;
    `;
    const [rows] = await pool.query(query, [`${prefix}%`]);
    const nextNumber = rows[0].next_num.toString().padStart(5, '0');
    return `${prefix}${nextNumber}`;
};

/**
 * Mencari SO yang valid untuk dimuat (aktif, belum close, qty invoice < qty so).
 */
const searchSo = async (term, page, itemsPerPage, user) => {
    const offset = (Number(page) - 1) * Number(itemsPerPage);
    const searchTerm = `%${term || ''}%`;
    const params = [user.cabang];

    // Subquery untuk menghitung qty SO dan Qty Invoice
    const subQuery = `
        SELECT 
            h.so_nomor AS Nomor, h.so_tanggal AS Tanggal, h.so_cus_kode AS KdCus,
            c.cus_nama AS Customer, c.cus_alamat AS Alamat, c.cus_kota AS Kota,
            IFNULL((SELECT SUM(dd.sod_jumlah) FROM tso_dtl dd WHERE dd.sod_so_nomor = h.so_nomor), 0) AS qty_so,
            IFNULL((
                SELECT SUM(dd.invd_jumlah) FROM tinv_dtl dd
                LEFT JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor
                WHERE hh.inv_sts_pro = 0 AND hh.inv_nomor_so = h.so_nomor
            ), 0) AS qty_inv
        FROM tso_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
        WHERE h.so_aktif = "Y" AND h.so_close = 0 AND LEFT(h.so_nomor, 3) = ?
    `;

    // Derived table 'x' untuk memfilter, persis seperti di Delphi
    const baseFrom = `FROM (${subQuery}) AS x`;
    const whereClause = `WHERE x.qty_inv < x.qty_so`;
    const searchClause = `AND (x.Nomor LIKE ? OR x.Customer LIKE ?)`;

    if (term) {
        params.push(searchTerm, searchTerm);
    }
    
    const countQuery = `SELECT COUNT(*) AS total ${baseFrom} ${whereClause} ${term ? searchClause : ''}`;
    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0].total;

    params.push(Number(itemsPerPage), offset);
    const dataQuery = `
        SELECT x.Nomor, x.Tanggal, x.Customer, x.Kota
        ${baseFrom} ${whereClause} ${term ? searchClause : ''}
        ORDER BY x.Nomor DESC
        LIMIT ? OFFSET ?;
    `;
    const [items] = await pool.query(dataQuery, params);
    
    return { items, total };
};

/**
 * Memuat detail item dari SO yang dipilih, lengkap dengan perhitungan stok.
 */
const loadFromSo = async (nomorSo, user) => {
    const query = `
        SELECT
            d.sod_kode AS kode,
            b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d.sod_ukuran AS ukuran,
            d.sod_jumlah AS qtyso,
            IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=d.sod_kode AND m.mst_ukuran=d.sod_ukuran), 0) AS showroom,
            IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstokso m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=d.sod_kode AND m.mst_ukuran=d.sod_ukuran AND m.mst_nomor_so=?), 0) AS pesan
        FROM tso_dtl d
        JOIN tbarangdc a ON a.brg_kode = d.sod_kode AND a.brg_logstok="Y"
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sod_kode AND b.brgd_ukuran = d.sod_ukuran
        WHERE d.sod_so_nomor = ?;
    `;
    const [rows] = await pool.query(query, [user.cabang, user.cabang, nomorSo, nomorSo]);

    // Lakukan kalkulasi 'produksi', 'ready', 'kurang' di backend
    return rows.map(item => {
        // Logika Delphi: ready = produksi + pesan, kurang = qtyso - ready
        // Karena 'produksi' tidak bisa dihitung langsung di sini, kita set 0
        const produksi = 0; // Placeholder
        const ready = produksi + item.pesan;
        const kurang = item.qtyso - ready;
        return { ...item, produksi, ready, kurang };
    });
};

/**
 * Menyimpan data Mutasi Stok (baru atau edit).
 */
const saveData = async (payload, user) => {
    const { header, items, isNew } = payload;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Validasi
        if (!header.nomorSo) throw new Error('No. Pesanan harus diisi.');
        if (items.length === 0) throw new Error('Detail barang harus diisi.');
        const totalQty = items.reduce((sum, item) => sum + (item.jumlah || 0), 0);
        if (totalQty <= 0) throw new Error('Qty Mutasi kosong semua.');
        
        for (const item of items) {
            const qtyMutasi = item.jumlah || 0;
            if (header.jenisMutasi === 'SP' && qtyMutasi > item.showroom) throw new Error(`Qty untuk ${item.nama} > Stok Showroom.`);
            if (header.jenisMutasi === 'PS' && qtyMutasi > item.pesan) throw new Error(`Qty untuk ${item.nama} > Stok Pesanan.`);
        }

        let msoNomor = header.nomor;
        const timestamp = format(new Date(), 'yyyyMMddHHmmssSSS');
        const idrec = `${user.cabang}MSO${timestamp}`;

        if (isNew) {
            msoNomor = await generateNewMsoNumber(user.cabang, header.tanggal);
            const headerSql = `
                INSERT INTO tmutasistok_hdr (mso_idrec, mso_nomor, mso_tanggal, mso_so_nomor, mso_ket, mso_jenis, user_create, date_create)
                VALUES (?, ?, ?, ?, ?, ?, ?, NOW());
            `;
            await connection.query(headerSql, [idrec, msoNomor, header.tanggal, header.nomorSo, header.keterangan, header.jenisMutasi, user.kode]);
        } else {
            // Logika update (jika diperlukan)
        }
        
        await connection.query('DELETE FROM tmutasistok_dtl WHERE msod_nomor = ?', [msoNomor]);

        const detailSql = `
            INSERT INTO tmutasistok_dtl (msod_idrec, msod_nomor, msod_kode, msod_ukuran, msod_jumlah) 
            VALUES ?;
        `;
        const detailValues = items.filter(item => (item.jumlah || 0) > 0).map(item => [idrec, msoNomor, item.kode, item.ukuran, item.jumlah]);
        
        if (detailValues.length > 0) {
            await connection.query(detailSql, [detailValues]);
        }

        await connection.commit();
        return { message: `Mutasi Stok ${msoNomor} berhasil disimpan.`, nomor: msoNomor };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const loadForEdit = async (nomor, user) => {
    // 1. Ambil data header Mutasi Stok
    const headerQuery = `
        SELECT 
            h.mso_nomor AS nomor, 
            h.mso_tanggal AS tanggal, 
            h.mso_so_nomor AS nomorSo,
            h.mso_jenis AS jenisMutasi,
            h.mso_ket AS keterangan
        FROM tmutasistok_hdr h
        WHERE h.mso_nomor = ? AND LEFT(h.mso_nomor, 3) = ?;
    `;
    const [headerRows] = await pool.query(headerQuery, [nomor, user.cabang]);
    if (headerRows.length === 0) throw new Error('Data Mutasi Stok tidak ditemukan.');
    const header = headerRows[0];

    // 2. Query kompleks untuk mengambil detail dari SO asli, lengkap dengan semua perhitungan stok
    const itemsQuery = `
        SELECT
            d.sod_kode AS kode,
            b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d.sod_ukuran AS ukuran,
            d.sod_jumlah AS qtyso,
            IFNULL(msod.msod_jumlah, 0) AS jumlah,
            IFNULL((SELECT SUM(m.mst_stok_in-m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif="Y" and m.mst_cab=? AND m.mst_brg_kode=d.sod_kode AND m.mst_ukuran=d.sod_ukuran),0) AS showroom,
            IFNULL((SELECT SUM(m.mst_stok_in-m.mst_stok_out) FROM tmasterstokso m WHERE m.mst_aktif="Y" and m.mst_cab=? AND m.mst_brg_kode=d.sod_kode AND m.mst_ukuran=d.sod_ukuran and m.mst_nomor_so=?),0) AS pesan
        FROM tso_dtl d
        JOIN tso_hdr h ON h.so_nomor = d.sod_so_nomor
        JOIN tbarangdc a ON a.brg_kode = d.sod_kode AND a.brg_logstok = "Y"
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sod_kode AND b.brgd_ukuran = d.sod_ukuran
        LEFT JOIN tmutasistok_dtl msod ON msod.msod_nomor = ? AND msod.msod_kode = d.sod_kode AND msod.msod_ukuran = d.sod_ukuran
        WHERE d.sod_so_nomor = ?;
    `;
    const params = [user.cabang, user.cabang, header.nomorSo, nomor, header.nomorSo];
    const [items] = await pool.query(itemsQuery, params);

    const processedItems = items.map(item => {
        const produksi = 0; // Placeholder, karena kalkulasi 'masuk' & 'keluar' sangat kompleks
        const ready = produksi + item.pesan;
        const kurang = item.qtyso - ready;
        return { ...item, produksi, ready, kurang };
    });

    return { header, items: processedItems };
};

const getPrintData = async (nomor) => {
    const query = `
        SELECT 
            h.mso_nomor, h.mso_tanggal, h.mso_so_nomor, h.mso_ket,
            IF(h.mso_jenis="SP", "Showroom ke Pesanan", "Pesanan ke Showroom") AS jenis_mutasi,
            d.msod_kode, d.msod_ukuran, d.msod_jumlah,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            DATE_FORMAT(h.date_create, "%d-%m-%Y %T") AS created,
            h.user_create,
            src.gdg_inv_nama AS perush_nama,
            src.gdg_inv_alamat AS perush_alamat,
            src.gdg_inv_telp AS perush_telp
        FROM tmutasistok_hdr h
        LEFT JOIN tmutasistok_dtl d ON d.msod_nomor = h.mso_nomor
        LEFT JOIN tbarangdc a ON a.brg_kode = d.msod_kode
        LEFT JOIN tgudang src ON src.gdg_kode = LEFT(h.mso_nomor, 3)
        WHERE h.mso_nomor = ?
        ORDER BY d.msod_kode, d.msod_ukuran;
    `;
    
    const [rows] = await pool.query(query, [nomor]);
    if (rows.length === 0) throw new Error('Data Mutasi Stok tidak ditemukan.');

    const header = { ...rows[0] };
    const details = rows.map(row => ({
        msod_kode: row.msod_kode,
        nama: row.nama,
        msod_ukuran: row.msod_ukuran,
        msod_jumlah: row.msod_jumlah,
    }));

    return { header, details };
};

const getExportDetails = async (filters) => {
    const { startDate, endDate, cabang } = filters;
    const query = `
        SELECT 
            h.mso_nomor AS 'Nomor Mutasi',
            h.mso_tanggal AS 'Tanggal',
            IF(h.mso_jenis="SP", "Showroom ke Pesanan", "Pesanan ke Showroom") AS 'Jenis Mutasi',
            h.mso_so_nomor AS 'No SO',
            c.cus_nama AS 'Customer',
            h.mso_ket AS 'Keterangan Header',
            d.msod_kode AS 'Kode Barang',
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS 'Nama Barang',
            d.msod_ukuran AS 'Ukuran',
            d.msod_jumlah AS 'Qty'
        FROM tmutasistok_hdr h
        JOIN tmutasistok_dtl d ON h.mso_nomor = d.msod_nomor
        LEFT JOIN tso_hdr o ON o.so_nomor = h.mso_so_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = o.so_cus_kode
        LEFT JOIN tbarangdc a ON a.brg_kode = d.msod_kode
        WHERE LEFT(h.mso_nomor, 3) = ?
          AND h.mso_tanggal BETWEEN ? AND ?
        ORDER BY h.mso_nomor, d.msod_kode;
    `;
    const [rows] = await pool.query(query, [cabang, startDate, endDate]);
    return rows;
};


module.exports = {
    searchSo,
    loadFromSo,
    saveData,
    loadForEdit,
    getPrintData,
    getExportDetails,
};
