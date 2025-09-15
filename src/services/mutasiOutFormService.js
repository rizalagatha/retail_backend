const pool = require('../config/database');
const { format } = require('date-fns');

/**
 * @description Helper function dari Delphi 'getsudah'.
 */
const getSudah = async (connection, soNomor, kode, ukuran, excludeMoNomor) => {
    const query = `
        SELECT IFNULL(SUM(mod_jumlah), 0) AS total 
        FROM retail.tmutasiout_dtl
        JOIN retail.tmutasiout_hdr ON mo_nomor = mod_nomor
        WHERE mo_nomor <> ? AND mo_so_nomor = ? AND mod_kode = ? AND mod_ukuran = ?
    `;
    const [rows] = await connection.query(query, [excludeMoNomor || '', soNomor, kode, ukuran]);
    return rows[0].total;
};

/**
 * @description Mencari SO yang valid untuk diinput (form bantuan F1).
 */
const searchSo = async (filters, user) => {
    const { term, page = 1, itemsPerPage = 10 } = filters;
    const searchTerm = `%${term}%`;
    const offset = (page - 1) * itemsPerPage;
    
    const countQuery = `
        SELECT COUNT(*) as total FROM (
            SELECT h.so_nomor
            FROM tso_hdr h
            LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
            WHERE h.so_aktif = "Y" AND h.so_close = 0 AND LEFT(h.so_nomor, 3) = ?
              AND (h.so_nomor LIKE ? OR c.cus_nama LIKE ?)
              AND IFNULL((SELECT SUM(dd.invd_jumlah) FROM tinv_dtl dd JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor WHERE hh.inv_sts_pro=0 AND hh.inv_nomor_so = h.so_nomor), 0) < 
                  IFNULL((SELECT SUM(dd.sod_jumlah) FROM tso_dtl dd WHERE dd.sod_so_nomor = h.so_nomor), 0)
        ) x
    `;
    const [totalRows] = await pool.query(countQuery, [user.cabang, searchTerm, searchTerm]);
    const total = totalRows[0].total;

    const dataQuery = `
        SELECT x.Nomor, x.Tanggal, x.KdCus, x.Customer, x.Alamat, x.Kota
        FROM (
            SELECT 
                h.so_nomor AS Nomor, h.so_tanggal AS Tanggal, h.so_cus_kode AS KdCus,
                c.cus_nama AS Customer, c.cus_alamat AS Alamat, c.cus_kota AS Kota,
                IFNULL((SELECT SUM(dd.sod_jumlah) FROM tso_dtl dd WHERE dd.sod_so_nomor = h.so_nomor), 0) AS qtyso,
                IFNULL((SELECT SUM(dd.invd_jumlah) FROM tinv_dtl dd JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor WHERE hh.inv_sts_pro=0 AND hh.inv_nomor_so = h.so_nomor), 0) AS qtyinv
            FROM tso_hdr h
            LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
            WHERE h.so_aktif = "Y" AND h.so_close = 0 AND LEFT(h.so_nomor, 3) = ?
              AND (h.so_nomor LIKE ? OR c.cus_nama LIKE ?)
        ) x 
        WHERE x.qtyinv < x.qtyso
        ORDER BY x.Nomor DESC
    `;
    const [items] = await pool.query(dataQuery, [user.cabang, searchTerm, searchTerm, parseInt(itemsPerPage, 10), offset]);
    
    return { items, total };
};

/**
 * @description Mengambil detail SO untuk mengisi grid (logika edtsoExit).
 */
// Ganti fungsi getSoDetailsForGrid Anda dengan yang ini

const getSoDetailsForGrid = async (soNomor, user) => {
    const connection = await pool.getConnection();
    try {
        // Query ini telah diperbaiki agar lebih tangguh (robust)
        const query = `
            SELECT 
                d.sod_kode AS kode, 
                IFNULL(b.brgd_barcode, '') AS barcode,
                IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe)), d.sod_kode) AS nama,
                d.sod_ukuran AS ukuran,
                IFNULL((
                    SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                    FROM tmasterstok m 
                    WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=d.sod_kode AND m.mst_ukuran=d.sod_ukuran
                ), 0) AS stok,
                d.sod_jumlah AS qtyso
            FROM tso_dtl d
            JOIN tso_hdr h ON d.sod_so_nomor = h.so_nomor
            LEFT JOIN tbarangdc a ON a.brg_kode = d.sod_kode AND a.brg_logstok="Y"
            LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sod_kode AND b.brgd_ukuran = d.sod_ukuran
            WHERE h.so_aktif = "Y" AND h.so_nomor = ?
            ORDER BY d.sod_nourut
        `;
        const [rows] = await connection.query(query, [user.cabang, soNomor]);
        
        const items = [];
        for (const row of rows) {
            const sudah = await getSudah(connection, soNomor, row.kode, row.ukuran, '');
            items.push({
                ...row,
                sudah: sudah,
                belum: row.qtyso - sudah,
                jumlah: 0, // Default Qty Out
            });
        }
        return items;
    } finally {
        connection.release();
    }
};

/**
 * @description Menyimpan data Mutasi Out (logika simpandata).
 */
const save = async (data, user) => {
    const { header, items, isNew } = data;
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
        let moNomor = header.nomor;
        if (isNew) {
            const prefix = `${user.cabang}MO${format(new Date(header.tanggal), 'yyMM')}`;
            const [maxRows] = await connection.query(`SELECT IFNULL(MAX(RIGHT(mo_nomor, 5)), 0) as maxNum FROM tmutasiout_hdr WHERE LEFT(mo_nomor, 9) = ?`, [prefix]);
            const nextNum = parseInt(maxRows[0].maxNum, 10) + 1;
            moNomor = `${prefix}${String(100000 + nextNum).slice(1)}`;
        }

        if (isNew) {
            await connection.query('INSERT INTO tmutasiout_hdr (mo_nomor, mo_tanggal, mo_so_nomor, mo_kecab, mo_ket, user_create, date_create) VALUES (?, ?, ?, ?, ?, ?, NOW())', [moNomor, header.tanggal, header.soNomor, header.keCabang, header.keterangan, user.kode]);
        } else {
            await connection.query('UPDATE tmutasiout_hdr SET mo_tanggal = ?, mo_kecab = ?, mo_ket = ?, user_modified = ?, date_modified = NOW() WHERE mo_nomor = ?', [header.tanggal, header.keCabang, header.keterangan, user.kode, moNomor]);
        }

        await connection.query('DELETE FROM tmutasiout_dtl WHERE mod_nomor = ?', [moNomor]);
        const validItems = items.filter(item => (item.jumlah || 0) > 0);
        for (const item of validItems) {
            await connection.query('INSERT INTO tmutasiout_dtl (mod_nomor, mod_kode, mod_ukuran, mod_jumlah) VALUES (?, ?, ?, ?)', [moNomor, item.kode, item.ukuran, item.jumlah]);
        }

        await connection.commit();
        return { message: `Data Mutasi Out ${moNomor} berhasil disimpan.`, nomor: moNomor };
    } catch (error) {
        await connection.rollback();
        console.error("Save Mutasi Out Error:", error);
        throw new Error('Gagal menyimpan data Mutasi Out.');
    } finally {
        connection.release();
    }
};

/**
 * @description Memuat data saat mode Ubah (logika loaddataall).
 */
const loadForEdit = async (nomor, user) => {
    const connection = await pool.getConnection();
    try {
        const [headerRows] = await connection.query('SELECT * FROM tmutasiout_hdr WHERE mo_nomor = ?', [nomor]);
        if (headerRows.length === 0) throw new Error('Data Mutasi Out tidak ditemukan.');
        const header = headerRows[0];
        
        const [savedDetails] = await connection.query('SELECT * FROM tmutasiout_dtl WHERE mod_nomor = ?', [nomor]);
        const templateItems = await getSoDetailsForGrid(header.mo_so_nomor, user);

        const items = templateItems.map(item => {
            const savedItem = savedDetails.find(d => d.mod_kode === item.kode && d.mod_ukuran === item.ukuran);
            return {
                ...item,
                jumlah: savedItem ? savedItem.mod_jumlah : 0,
            };
        });

        return { header, items };
    } finally {
        connection.release();
    }
};


module.exports = {
    searchSo,
    getSoDetailsForGrid,
    save,
    loadForEdit,
};