const pool = require('../config/database');
const { format } = require('date-fns');

// --- FUNGSI GENERATE NOMOR ---
const generateNewInvNumber = async (gudang, tanggal) => {
    const date = new Date(tanggal);
    const prefix = `${gudang}.INV.${format(date, 'yyMM')}.`;
    const query = `
        SELECT IFNULL(MAX(RIGHT(inv_nomor, 4)), 0) + 1 AS next_num
        FROM tinv_hdr 
        WHERE inv_nomor LIKE ?;
    `;
    const [rows] = await pool.query(query, [`${prefix}%`]);
    const nextNumber = rows[0].next_num.toString().padStart(4, '0');
    return `${prefix}${nextNumber}`;
};

// --- FUNGSI LOOKUP ---
const searchSo = async (term, page, itemsPerPage, user) => {
    const offset = (page - 1) * itemsPerPage;
    const searchTerm = `%${term || ''}%`;
    
    const subQuery = `
        SELECT 
            h.so_nomor AS Nomor, h.so_tanggal AS Tanggal, h.so_cus_kode AS KdCus, 
            c.cus_nama AS Customer, c.cus_alamat AS Alamat, c.cus_kota AS Kota,
            IFNULL((SELECT SUM(dd.sod_jumlah) FROM tso_dtl dd WHERE dd.sod_so_nomor = h.so_nomor), 0) AS qtyso,
            IFNULL((SELECT SUM(dd.invd_jumlah) FROM tinv_dtl dd JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor WHERE hh.inv_sts_pro = 0 AND hh.inv_nomor_so = h.so_nomor), 0) AS qtyinv
        FROM tso_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
        WHERE h.so_aktif = "Y" AND h.so_close = 0 AND LEFT(h.so_nomor, 3) = ?
    `;
    
    const baseQuery = `FROM (${subQuery}) AS x WHERE x.qtyinv < x.qtyso`;
    const searchWhere = `AND (x.Nomor LIKE ? OR x.Customer LIKE ?)`;

    const countParams = [user.cabang];
    const dataParams = [user.cabang];

    if (term) {
        countParams.push(searchTerm, searchTerm);
        dataParams.push(searchTerm, searchTerm);
    }
    
    const countQuery = `SELECT COUNT(*) AS total ${baseQuery} ${term ? searchWhere : ''}`;
    const [countRows] = await pool.query(countQuery, countParams);

    dataParams.push(itemsPerPage, offset);
    const dataQuery = `
        SELECT x.Nomor, x.Tanggal, x.KdCus, x.Customer 
        ${baseQuery} ${term ? searchWhere : ''} 
        ORDER BY x.Nomor DESC 
        LIMIT ? OFFSET ?`;
    const [items] = await pool.query(dataQuery, dataParams);
    
    return { items, total: countRows[0].total };
};

const getSoDetailsForGrid = async (soNomor, user) => {
    // Query ini mereplikasi logika dari edtSoExit di Delphi
    const query = `
        SELECT 
            d.sod_kode AS kode, b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d.sod_ukuran AS ukuran,
            d.sod_harga AS harga, d.sod_diskon AS diskonRp, d.sod_disc AS diskonPersen,
            b.brgd_hpp AS hpp, a.brg_logstok AS logstok,
            (SELECT IFNULL(SUM(m.mst_stok_in-m.mst_stok_out), 0) FROM tmasterstokso m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=d.sod_kode AND m.mst_ukuran=d.sod_ukuran AND m.mst_nomor_so=?) AS stok,
            (d.sod_jumlah - IFNULL((SELECT SUM(id.invd_jumlah) FROM tinv_dtl id JOIN tinv_hdr ih ON id.invd_inv_nomor = ih.inv_nomor WHERE ih.inv_nomor_so = d.sod_so_nomor AND id.invd_kode = d.sod_kode AND id.invd_ukuran = d.sod_ukuran), 0)) AS qtyso
        FROM tso_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.sod_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sod_kode AND b.brgd_ukuran = d.sod_ukuran
        WHERE d.sod_so_nomor = ?;
    `;
    const [rows] = await pool.query(query, [user.cabang, soNomor, soNomor]);
    return rows;
};

const searchCustomer = async (filters, user) => { /* ... (Logika pencarian customer) ... */ };
const searchRekening = async (filters, user) => { /* ... (Logika pencarian rekening) ... */ };

const searchUnpaidDp = async (customerKode, user) => {
    const query = `
        SELECT 
            h.sh_nomor AS nomor, 
            IF(h.sh_jenis=0, "TUNAI", IF(h.sh_jenis=1, "TRANSFER", "GIRO")) AS jenis,
            (h.sh_nominal - IFNULL((SELECT SUM(d.sd_bayar) FROM tsetor_dtl d WHERE d.sd_sh_nomor = h.sh_nomor), 0)) AS nominal
        FROM tsetor_hdr h
        WHERE h.sh_cus_kode = ? AND LEFT(h.sh_nomor, 3) = ?
        HAVING nominal > 0;
    `;
    const [rows] = await pool.query(query, [customerKode, user.cabang]);
    return rows;
};

// --- FUNGSI UTAMA ---
const loadForEdit = async (nomor, user) => { /* ... (Logika load data edit dari Delphi loaddataall) ... */ };

const saveData = async (payload, user) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        // Implementasi logika SANGAT kompleks dari 'simpandata' di Delphi
        // 1. Validasi
        // 2. Generate Nomor Baru jika isNew
        // 3. Insert/Update tinv_hdr
        // 4. Delete/Insert tpiutang_hdr & tpiutang_dtl (termasuk debet, kredit, dp, biaya kirim)
        // 5. Delete/Insert tsetor_hdr & tsetor_dtl jika ada pembayaran Card/Transfer
        // 6. Delete/Insert tinv_dtl
        // 7. Insert/Update tmember
        // 8. Cek dan Insert tinv_kupon
        // 9. Insert totorisasi
        await connection.commit();
        // Placeholder, logika sebenarnya sangat panjang
        const newNomor = isNew ? await generateNewInvNumber(user.cabang, payload.header.tanggal) : payload.header.nomor;
        return { message: `Invoice ${newNomor} berhasil disimpan.`, nomor: newNomor };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const getSalesCounters = async () => {
    const query = 'SELECT sc_kode FROM tsalescounter WHERE sc_aktif="Y" ORDER BY sc_kode';
    const [rows] = await pool.query(query);
    // Kembalikan sebagai array of strings agar mudah digunakan di v-select
    return rows.map(row => row.sc_kode);
};

module.exports = {
    searchSo,
    getSoDetailsForGrid,
    searchCustomer,
    searchRekening,
    searchUnpaidDp,
    loadForEdit,
    saveData,
    getSalesCounters,
};

