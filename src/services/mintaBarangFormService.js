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
                d.sod_kode AS kode, b.brgd_barcode AS barcode,
                TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe)) AS nama,
                d.sod_ukuran AS ukuran,
                IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=d.sod_kode AND m.mst_ukuran=d.sod_ukuran), 0) AS stok,
                d.sod_jumlah AS qtyso
            FROM tso_dtl d
            JOIN tso_hdr h ON d.sod_so_nomor = h.so_nomor
            JOIN tbarangdc a ON a.brg_kode = d.sod_kode
            LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sod_kode AND b.brgd_ukuran = d.sod_ukuran
            WHERE h.so_aktif = "Y" AND h.so_nomor = ?
            ORDER BY d.sod_nourut
        `;
        const [rows] = await connection.query(query, [user.cabang, soNomor]);
        
        const items = [];
        for (const row of rows) {
            const sudah = await getSudah(connection, soNomor, row.kode, row.ukuran, '');
            items.push({ ...row, sudah, belum: row.qtyso - sudah, jumlah: 0 });
        }
        return items;
    } finally {
        connection.release();
    }
};

const getBufferStokItems = async (user) => { /* ... (Implementasi query dari btnRefreshClick PanelPSM) ... */ };

const save = async (data, user) => { /* ... (Implementasi lengkap dari simpandata) ... */ };
const loadForEdit = async (nomor, user) => { /* ... (Implementasi lengkap dari loaddataall) ... */ };

module.exports = {
    getSoDetailsForGrid, 
    getBufferStokItems, 
    save, 
    loadForEdit,
};
