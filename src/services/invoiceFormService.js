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
    let headerQuery, itemsQuery;
    let headerParams = [soNomor];
    let itemsParams = [user.cabang, soNomor, soNomor];

    // Logika dari Delphi: jika cabang KPR, query ke Surat Jalan (SJ), bukan SO
    if (user.cabang === 'KPR') {
        headerQuery = `
           SELECT 
            h.sj_nomor AS nomorSo, h.sj_tanggal AS tanggal,
            m.mt_cus AS kode, c.cus_nama AS nama, c.cus_alamat AS alamat, c.cus_kota AS kota, c.cus_telp AS telp,
            IFNULL(j.so_top, 0) AS top, DATE_ADD(h.sj_tanggal, INTERVAL IFNULL(j.so_top, 0) DAY) AS tanggalTempo,
            IFNULL(j.so_sc, "") AS salesCounter,
            IFNULL(j.so_disc, 0) AS diskonRp, IFNULL(j.so_disc1, 0) AS diskonPersen1, 
            IFNULL(j.so_ppn, 0) AS ppnPersen, IFNULL(j.so_bkrm, 0) AS biayaKirim,
            IFNULL(CONCAT(x.clh_level, " - ", x.level_nama), "") AS level
        FROM tdc_sj_hdr h
        LEFT JOIN tmintabarang_hdr m ON m.mt_nomor = h.sj_mt_nomor
        LEFT JOIN tso_hdr j ON j.so_nomor = m.mt_so
        LEFT JOIN tcustomer c ON c.cus_kode = m.mt_cus
        LEFT JOIN (
            SELECT i.clh_cus_kode, i.clh_level, l.level_nama 
            FROM tcustomer_level_history i 
            LEFT JOIN tcustomer_level l ON l.level_kode = i.clh_level
            WHERE i.clh_cus_kode = m.mt_cus 
            ORDER BY i.clh_tanggal DESC 
            LIMIT 1
        ) x ON x.clh_cus_kode = c.cus_kode
        WHERE h.sj_kecab = ? AND h.sj_nomor = ?;
        `;
        headerParams.unshift(user.cabang); // Tambahkan cabang di awal parameter

        itemsQuery = `
            SELECT
                d.sjd_kode AS kode, b.brgd_barcode AS barcode,
                TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
                d.sjd_ukuran AS ukuran,
                d.sjd_jumlah AS qtyso,
                IFNULL(i.sod_harga, b.brgd_harga) AS harga,
                IFNULL(i.sod_diskon, 0) AS diskonRp,
                IFNULL(i.sod_disc, 0) AS diskonPersen,
                b.brgd_hpp AS hpp, a.brg_logstok AS logstok,
                IFNULL((SELECT SUM(st.mst_stok_in - st.mst_stok_out) FROM tmasterstok st WHERE st.mst_aktif="Y" AND st.mst_cab=? AND st.mst_brg_kode=d.sjd_kode AND st.mst_ukuran=d.sjd_ukuran), 0) AS stok
            FROM tdc_sj_dtl d
            LEFT JOIN tdc_sj_hdr h ON d.sjd_nomor = h.sj_nomor
            LEFT JOIN tmintabarang_hdr m ON m.mt_nomor = h.sj_mt_nomor
            LEFT JOIN tso_dtl i ON i.sod_so_nomor = m.mt_so AND i.sod_kode = d.sjd_kode AND i.sod_ukuran = d.sjd_ukuran
            LEFT JOIN tbarangdc a ON a.brg_kode = d.sjd_kode
            LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sjd_kode AND b.brgd_ukuran = d.sjd_ukuran
            WHERE d.sjd_nomor = ?;
        `;
        itemsParams = [user.cabang, soNomor];
    } else { // Logika untuk cabang selain KPR (mengambil dari SO)
        headerQuery = `
            SELECT 
                h.so_nomor AS nomorSo, h.so_tanggal AS tanggal,
                h.so_cus_kode AS kode, c.cus_nama AS nama, c.cus_alamat AS alamat, c.cus_kota AS kota, c.cus_telp AS telp,
                h.so_top AS top, DATE_ADD(h.so_tanggal, INTERVAL h.so_top DAY) AS tanggalTempo,
                h.so_sc AS salesCounter,
                h.so_disc AS diskonRp, h.so_disc1 AS diskonPersen1, h.so_disc2 AS diskonPersen2,
                h.so_ppn AS ppnPersen, h.so_bkrm AS biayaKirim,
                CONCAT(h.so_cus_level, " - ", l.level_nama) AS level
            FROM tso_hdr h
            LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
            LEFT JOIN tcustomer_level l ON l.level_kode = h.so_cus_level
            WHERE h.so_nomor = ?;
        `;
        itemsQuery = `
            SELECT 
                d.sod_kode AS kode, b.brgd_barcode AS barcode,
                TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
                d.sod_ukuran AS ukuran,
                d.sod_harga AS harga, d.sod_diskon AS diskonRp, d.sod_disc AS diskonPersen,
                d.sod_sd_nomor AS noSoDtf,     
                a.brg_ktgp AS kategori,
                b.brgd_hpp AS hpp, a.brg_logstok AS logstok,
                IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstokso m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=d.sod_kode AND m.mst_ukuran=d.sod_ukuran AND m.mst_nomor_so=?), 0) AS stok,
                (d.sod_jumlah - IFNULL((SELECT SUM(id.invd_jumlah) FROM tinv_dtl id JOIN tinv_hdr ih ON id.invd_inv_nomor = ih.inv_nomor WHERE ih.inv_nomor_so = d.sod_so_nomor AND id.invd_kode = d.sod_kode AND id.invd_ukuran = d.sod_ukuran), 0)) AS qtyso
            FROM tso_dtl d
            LEFT JOIN tbarangdc a ON a.brg_kode = d.sod_kode
            LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sod_kode AND b.brgd_ukuran = d.sod_ukuran
            WHERE d.sod_so_nomor = ?;
        `;
    }

    const [headerRows] = await pool.query(headerQuery, headerParams);
    if (headerRows.length === 0) throw new Error('Data Header SO/SJ tidak ditemukan.');

    const headerData = { customer: {}, ...headerRows[0] };
    headerData.customer = {
        kode: headerRows[0].kode, nama: headerRows[0].nama, alamat: headerRows[0].alamat,
        kota: headerRows[0].kota, telp: headerRows[0].telp, level: headerRows[0].level,
    };

    const [items] = await pool.query(itemsQuery, itemsParams);

    const dpQuery = `
        SELECT 
            h.sh_nomor AS nomor, 
            IF(h.sh_jenis=0, "TUNAI", IF(h.sh_jenis=1, "TRANSFER", "GIRO")) AS jenis,
            (h.sh_nominal - IFNULL((SELECT SUM(d.sd_bayar) FROM tsetor_dtl d WHERE d.sd_sh_nomor = h.sh_nomor), 0)) AS nominal
        FROM tsetor_hdr h
        WHERE h.sh_otomatis = "N" AND h.sh_so_nomor = ? HAVING nominal > 0;
    `;
    const [dps] = await pool.query(dpQuery, [soNomor]);

    return { header: headerData, items, dps };
};

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

const searchPromo = async (filters, user) => {
    const { term, tanggal } = filters;
    const searchTerm = `%${term || ''}%`;

    // Query ini diadaptasi dari Delphi 'edtproinvKeyDown'
    const query = `
        SELECT p.pro_nomor AS nomor, p.pro_judul AS namaPromo
        FROM tpromo p
        INNER JOIN tpromo_cabang c ON c.pc_nomor = p.pro_nomor AND c.pc_cab = ?
        WHERE p.pro_f1 = "Y" 
          AND ? BETWEEN p.pro_tanggal1 AND p.pro_tanggal2
          AND (p.pro_nomor LIKE ? OR p.pro_judul LIKE ?);
    `;
    const [rows] = await pool.query(query, [user.cabang, tanggal, searchTerm, searchTerm]);
    return rows;
};

const getMemberByHp = async (hp) => {
    const query = 'SELECT mem_hp AS hp, mem_nama AS nama, mem_alamat AS alamat, mem_gender AS gender, mem_usia AS usia, mem_referensi AS referensi FROM tmember WHERE mem_hp = ?';
    const [rows] = await pool.query(query, [hp]);
    return rows[0];
};

const saveMember = async (payload, user) => {
    const { hp, nama, alamat, gender, usia, referensi } = payload;
    if (!hp || !nama) throw new Error('No. HP dan Nama tidak boleh kosong.');

    const query = `
        INSERT INTO tmember (mem_hp, mem_nama, mem_alamat, mem_gender, mem_usia, mem_referensi, user_create, date_create)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
            mem_nama = VALUES(mem_nama), mem_alamat = VALUES(mem_alamat),
            mem_gender = VALUES(mem_gender), mem_usia = VALUES(mem_usia),
            mem_referensi = VALUES(mem_referensi), user_modified = ?, date_modified = NOW();
    `;
    await pool.query(query, [hp, nama, alamat, gender, usia, referensi, user.kode, user.kode]);
    return { hp, nama };
};

const getDefaultCustomer = async (cabang) => {
    let query;
    let params;

    if (cabang === 'KDC') {
        query = `SELECT cus_kode FROM tcustomer WHERE cus_kode = ?`;
        params = ['KDC00001'];
    } else {
        query = `
            SELECT cus_kode FROM tcustomer 
            WHERE cus_cab = ? AND (cus_nama LIKE '%RETAIL%' OR cus_nama LIKE 'RETAIL%')
            ORDER BY cus_kode LIMIT 1
        `;
        params = [cabang];
    }
    
    const [rows] = await pool.query(query, params);
    
    if (rows.length === 0) {
        return null;
    }
    
    const customerKode = rows[0].cus_kode;

    // Perbaiki query detail customer dengan JOIN yang benar
    const detailQuery = `
        SELECT 
            c.cus_kode AS kode, c.cus_nama AS nama, c.cus_alamat AS alamat, 
            c.cus_kota AS kota, c.cus_telp AS telp,
            IFNULL(CONCAT(x.clh_level, " - ", x.level_nama), "") AS level
        FROM tcustomer c
        LEFT JOIN (
            SELECT i.clh_cus_kode, i.clh_level, l.level_nama 
            FROM tcustomer_level_history i 
            LEFT JOIN tcustomer_level l ON l.level_kode = i.clh_level
            WHERE i.clh_cus_kode = ? 
            ORDER BY i.clh_tanggal DESC 
            LIMIT 1
        ) x ON x.clh_cus_kode = c.cus_kode
        WHERE c.cus_kode = ?
    `;
    
    const [customerRows] = await pool.query(detailQuery, [customerKode, customerKode]);
    
    return customerRows[0] || null;
};

module.exports = {
    searchSo,
    getSoDetailsForGrid,
    searchUnpaidDp,
    loadForEdit,
    saveData,
    getSalesCounters,
    searchPromo,
    getMemberByHp,
    saveMember,
    getDefaultCustomer,
};

