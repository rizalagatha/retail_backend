const pool = require('../config/database');
const { format } = require('date-fns');

// Fungsi untuk mencari SO Stok yang valid (dari KeyDown F1)
const searchSoStok = async (filters) => {
    const { cabang, term } = filters;
    const searchTerm = `%${term}%`;
    const query = `
        SELECT * FROM (
            SELECT 
                h.sd_nomor AS nomor,
                h.sd_tanggal AS tanggal,
                h.sd_nama AS nama,
                IFNULL((SELECT SUM(dd.sds_jumlah) FROM tsodtf_stok dd WHERE dd.sds_nomor = h.sd_nomor), 0) AS qtySO,
                IFNULL((SELECT SUM(dd.dsd_jumlah) FROM tdtfstok_dtl dd JOIN tdtfstok_hdr hh ON hh.ds_nomor = dd.dsd_nomor WHERE hh.ds_sd_nomor = h.sd_nomor), 0) AS qtyLhk
            FROM tsodtf_hdr h
            WHERE h.sd_stok = "Y" AND h.sd_alasan = "" AND LEFT(h.sd_nomor, 3) = ?
              AND (h.sd_nomor LIKE ? OR h.sd_nama LIKE ?)
        ) x 
        WHERE x.qtyLhk < x.qtySO
        ORDER BY x.tanggal DESC, x.nomor DESC
    `;
    const [rows] = await pool.query(query, [cabang, searchTerm, searchTerm]);
    return rows;
};

// Fungsi untuk mengambil detail SO untuk mengisi grid (dari edtsoExit)
const getSoDetailsForGrid = async (soNomor) => {
    const query = `
        SELECT 
            d.sds_kode AS kode,
            a.brg_warna AS nama,
            d.sds_ukuran AS ukuran,
            d.sds_jumlah AS qtyso,
            IFNULL((SELECT SUM(dd.dsd_jumlah) FROM tdtfstok_dtl dd JOIN tdtfstok_hdr hh ON hh.ds_nomor=dd.dsd_nomor WHERE hh.ds_sd_nomor = d.sds_nomor AND dd.dsd_kode = d.sds_kode AND dd.dsd_ukuran = d.sds_ukuran), 0) AS sudah,
            (d.sds_jumlah - IFNULL((SELECT SUM(dd.dsd_jumlah) FROM tdtfstok_dtl dd JOIN tdtfstok_hdr hh ON hh.ds_nomor=dd.dsd_nomor WHERE hh.ds_sd_nomor = d.sds_nomor AND dd.dsd_kode = d.sds_kode AND dd.dsd_ukuran = d.sds_ukuran), 0)) AS belum
        FROM tsodtf_stok d
        JOIN tbarangdc a ON a.brg_kode = d.sds_kode
        WHERE d.sds_nomor = ?
        ORDER BY d.sds_nourut
    `;
    const [rows] = await pool.query(query, [soNomor]);
    return rows.map(row => ({ ...row, jumlah: 0 })); // Tambahkan field 'jumlah' untuk inputan user
};

// Fungsi untuk menyimpan data (dari simpandata)
const save = async (data, user) => {
    const { header, items, isNew } = data;
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
        let lhkNomor = header.nomor;
        if (isNew) {
            const prefix = `${user.cabang}DS${format(new Date(header.tanggal), 'yyMM')}`;
            const [maxRows] = await connection.query(`SELECT IFNULL(MAX(RIGHT(ds_nomor, 5)), 0) as maxNum FROM tdtfstok_hdr WHERE LEFT(ds_nomor, 9) = ?`, [prefix]);
            const nextNum = parseInt(maxRows[0].maxNum, 10) + 1;
            lhkNomor = `${prefix}${String(100000 + nextNum).slice(1)}`;
        }

        if (isNew) {
            await connection.query('INSERT INTO tdtfstok_hdr (ds_nomor, ds_tanggal, ds_sd_nomor, user_create, date_create) VALUES (?, ?, ?, ?, NOW())', [lhkNomor, header.tanggal, header.soNomor, user.kode]);
        } else {
            await connection.query('UPDATE tdtfstok_hdr SET ds_tanggal = ?, user_modified = ?, date_modified = NOW() WHERE ds_nomor = ?', [header.tanggal, user.kode, lhkNomor]);
        }

        await connection.query('DELETE FROM tdtfstok_dtl WHERE dsd_nomor = ?', [lhkNomor]);
        const validItems = items.filter(item => item.jumlah > 0);
        for (const item of validItems) {
            await connection.query('INSERT INTO tdtfstok_dtl (dsd_nomor, dsd_kode, dsd_ukuran, dsd_jumlah) VALUES (?, ?, ?, ?)', [lhkNomor, item.kode, item.ukuran, item.jumlah]);
        }

        await connection.commit();
        return { message: `Data LHK Stok ${lhkNomor} berhasil disimpan.`, nomor: lhkNomor };
    } catch (error) {
        await connection.rollback();
        console.error("Save LHK Stok Error:", error);
        throw new Error('Gagal menyimpan data LHK Stok.');
    } finally {
        connection.release();
    }
};

// Fungsi untuk memuat data saat mode Ubah
const loadForEdit = async (nomor) => { /* ... Implementasi ... */ };

module.exports = {
    searchSoStok,
    getSoDetailsForGrid,
    save,
    loadForEdit,
};
