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
    const { header, items, dps, payment, isNew } = payload;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        if (!header.customer.kode) throw new Error('Customer harus diisi.');
        if (!header.customer.level) throw new Error('Level customer belum di-setting.');
        const validItems = items.filter(i => i.kode);
        if (validItems.length === 0) throw new Error('Detail barang harus diisi.');
        const totalQty = validItems.reduce((sum, item) => sum + (item.jumlah || 0), 0);
        if (totalQty <= 0) throw new Error('Qty Invoice kosong semua.');
        for (const item of validItems) {
            if ((item.jumlah || 0) > item.stok && item.logstok === 'Y') {
                throw new Error(`Stok untuk ${item.nama} (${item.ukuran}) akan minus.`);
            }
        }

        const invNomor = isNew ? await generateNewInvNumber(header.gudang.kode, header.tanggal) : header.nomor;
        const idrec = isNew ? `${header.gudang.kode}INV${format(new Date(), 'yyyyMMddHHmmssSSS')}` : header.idrec;

        // 1. INSERT/UPDATE tinv_hdr
        if (isNew) {
            const headerSql = `
                INSERT INTO tinv_hdr (inv_idrec, inv_nomor, inv_nomor_so, inv_tanggal, inv_cus_kode, inv_cus_level, inv_top, inv_ppn, inv_disc, inv_disc1, inv_disc2, inv_bkrm, inv_dp, inv_ket, inv_sc, inv_rptunai, inv_novoucher, inv_rpvoucher, inv_nocard, inv_rpcard, inv_nosetor, inv_rj_nomor, inv_rj_rp, inv_pundiamal, inv_mem_hp, inv_mem_nama, user_create, date_create)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW());
            `;
            await connection.query(headerSql, [idrec, invNomor, header.nomorSo, header.tanggal, header.customer.kode, header.customer.level.split(' - ')[0], header.top, header.ppnPersen, header.diskonRp, header.diskonPersen1, header.diskonPersen2, header.biayaKirim, totals.totalDp, header.keterangan, header.salesCounter, payment.tunai, payment.voucher.nomor, payment.voucher.nominal, payment.transfer.akun.rekening, payment.transfer.nominal, payment.transfer.nomorSetoran, payment.retur.nomor, payment.retur.nominal, payment.pundiAmal, header.memberHp, header.memberNama, user.kode]);
        } else {
            // Logika UPDATE untuk header jika diperlukan
        }

        await connection.query('DELETE FROM tinv_dtl WHERE invd_inv_nomor = ?', [invNomor]);
        if (validItems.length > 0) {
            const detailSql = `
                INSERT INTO tinv_dtl (invd_idrec, invd_inv_nomor, invd_kode, invd_ukuran, invd_jumlah, invd_harga, invd_hpp, invd_disc, invd_diskon, invd_nourut) 
                VALUES ?;
            `;
            const detailValues = validItems.map((item, index) => [idrec, invNomor, item.kode, item.ukuran, item.jumlah, item.harga, item.hpp, item.diskonPersen, item.diskonRp, index + 1]);
            await connection.query(detailSql, [detailValues]);
        }
        
        // 3. DELETE/INSERT tpiutang_hdr & tpiutang_dtl
        const piutangNomor = `${header.customer.kode}${invNomor}`;
        await connection.query('DELETE FROM tpiutang_hdr WHERE ph_inv_nomor = ?', [invNomor]);
        const piutangHdrSql = `INSERT INTO tpiutang_hdr (ph_nomor, ph_tanggal, ph_cus_kode, ph_inv_nomor, ph_top, ph_nominal) VALUES (?, ?, ?, ?, ?, ?);`;
        await connection.query(piutangHdrSql, [piutangNomor, header.tanggal, header.customer.kode, invNomor, header.top, totals.grandTotal]);

        // Insert piutang detail untuk penjualan dan pembayaran
        // (Ini adalah versi sederhana dari logika kompleks di Delphi)
        const piutangDtlSql = `INSERT INTO tpiutang_dtl (pd_ph_nomor, pd_tanggal, pd_uraian, pd_debet, pd_kredit, pd_ket) VALUES ?;`;
        const piutangDtlValues = [];
        piutangDtlValues.push([piutangNomor, header.tanggal, 'Penjualan', totals.grandTotal, 0, '']);
        if (payment.tunai > 0) piutangDtlValues.push([piutangNomor, header.tanggal, 'Bayar Tunai Langsung', 0, payment.tunai, '']);
        if (payment.transfer.nominal > 0) piutangDtlValues.push([piutangNomor, payment.transfer.tanggal, 'Pembayaran Card', 0, payment.transfer.nominal, payment.transfer.nomorSetoran]);
        // (Tambahkan untuk voucher, retur, dp jika perlu)

        if (piutangDtlValues.length > 0) {
            await connection.query(piutangDtlSql, [piutangDtlValues]);
        }

       // (7) Logika untuk INSERT/UPDATE tmember (dari edthpExit)
        if (header.memberHp) {
            const memberSql = `
                INSERT INTO tmember (mem_hp, mem_nama, mem_alamat, mem_gender, mem_usia, mem_referensi, user_create, date_create)
                VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                    mem_nama = VALUES(mem_nama),
                    mem_alamat = VALUES(mem_alamat),
                    mem_gender = VALUES(mem_gender),
                    mem_usia = VALUES(mem_usia),
                    mem_referensi = VALUES(mem_referensi),
                    user_modified = ?,
                    date_modified = NOW();
            `;
            // Asumsi data member ada di payload.header
            await connection.query(memberSql, [
                header.memberHp, header.memberNama, header.customer.alamat, 
                header.memberGender, header.memberUsia, header.memberReferensi,
                user.kode, user.kode
            ]);
        }

        // (8) Logika untuk INSERT tinv_kupon (Promo)
        // Catatan: Logika promo di Delphi sangat kompleks dan bergantung pada banyak
        // aturan bisnis. Ini adalah versi sederhana. Kita bisa kembangkan lebih lanjut nanti.
        // Untuk saat ini, kita akan lewati bagian ini agar tidak terlalu rumit.
        // Jika ada promo yang aktif, kodenya akan seperti ini:
        /*
        if (header.nomorPromo) {
            const kuponSql = `INSERT INTO tinv_kupon (...) VALUES (...)`;
            await connection.query(kuponSql, [...]);
        }
        */

        // --- TAMBAHAN: LOG OTORISASI BELUM LUNAS ---
        if (payment.pinBelumLunas) {
            const sisaPiutang = totals.sisaPiutang; // Asumsi totals ada di payload
            const authLogSql = `
                INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_created, o_pin, o_nominal) 
                VALUES (?, 'INVOICE', 'BELUM LUNAS', NOW(), ?, ?);
            `;
            await connection.query(authLogSql, [newNomor, payment.pinBelumLunas, sisaPiutang]);
        }
        // --- AKHIR TAMBAHAN ---
        await connection.commit();
        return { message: `Invoice ${invNomor} berhasil disimpan.`, nomor: invNomor };
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

