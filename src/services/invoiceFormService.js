const pool = require('../config/database');
const { format } = require('date-fns');
const { getByBarcode } = require('../controllers/invoiceFormController');

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
                COALESCE(
                    TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)),
                    f.sd_nama
                ) AS nama,
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
            LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.sod_kode
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
        const { header, items, dps, payment, isNew, totals } = payload;

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

        let nomorSetoran = payment.transfer.nomorSetoran || '';
        if ((payment.transfer.nominal || 0) > 0 && !nomorSetoran) {
            nomorSetoran = await generateNewSetorNumber(connection, user.cabang, header.tanggal);
        }

        const invNomor = isNew ? await generateNewInvNumber(header.gudang.kode, header.tanggal) : header.nomor;
        const idrec = isNew ? `${header.gudang.kode}INV${format(new Date(), 'yyyyMMddHHmmssSSS')}` : header.idrec;

        // 1. INSERT/UPDATE tinv_hdr
        if (isNew) {
            const headerSql = `
                INSERT INTO tinv_hdr (inv_idrec, inv_nomor, inv_nomor_so, inv_tanggal, inv_cus_kode, inv_ket, inv_sc, inv_rptunai, inv_novoucher, inv_rpvoucher, inv_rpcard, inv_nosetor, user_create, date_create)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW());
            `;
            await connection.query(headerSql, [idrec, invNomor, header.nomorSo, header.tanggal, header.customer.kode, header.keterangan, header.salesCounter, payment.tunai, payment.voucher.nomor, payment.voucher.nominal, payment.transfer.nominal, nomorSetoran, user.kode]);
        } else {
            // Logika UPDATE untuk header jika diperlukan
        }

        await connection.query('DELETE FROM tinv_dtl WHERE invd_inv_nomor = ?', [invNomor]);
        if (validItems.length > 0) {
            const detailSql = `
                INSERT INTO tinv_dtl (invd_idrec, invd_inv_nomor, invd_kode, invd_ukuran, invd_jumlah, invd_harga, invd_hpp, invd_disc, invd_diskon, invd_nourut) 
                VALUES ?;
            `;
            const detailValues = validItems.map((item, index) => [idrec, invNomor, item.kode, item.ukuran, item.jumlah, item.harga, item.hpp || 0, item.diskonPersen, item.diskonRp, index + 1]);
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
            // Gunakan properti yang sudah kita definisikan di header frontend
            await connection.query(memberSql, [
                header.memberHp, header.memberNama, header.memberAlamat,
                header.memberGender, header.memberUsia, header.memberReferensi,
                user.kode, user.kode
            ]);
        }

        const { pinDiskon1, pinDiskon2 } = payload.pins || {};
        const { pinBelumLunas } = payload.payment || {};

        // Cek dan simpan PIN untuk Diskon Faktur 1
        if (pinDiskon1) {
            const authLogSql = `
                INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_pin, o_nominal, o_created) 
                VALUES (?, 'INVOICE', 'DISKON FAKTUR', ?, ?, NOW());
            `;
            await connection.query(authLogSql, [invNomor, pinDiskon1, header.diskonPersen1]);
        }

        // Cek dan simpan PIN untuk Diskon Faktur 2
        if (pinDiskon2) {
            const authLogSql = `
                INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_pin, o_nominal, o_created) 
                VALUES (?, 'INVOICE', 'DISKON FAKTUR 2', ?, ?, NOW());
            `;
            await connection.query(authLogSql, [invNomor, pinDiskon2, header.diskonPersen2]);
        }

        // Cek dan simpan PIN untuk Invoice Belum Lunas
        if (pinBelumLunas) {
            const authLogSql = `
                INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_pin, o_nominal, o_created) 
                VALUES (?, 'INVOICE', 'BELUM LUNAS', ?, ?, NOW());
            `;
            await connection.query(authLogSql, [invNomor, pinBelumLunas, totals.sisaPiutang]);
        }

        await handlePromotions(connection, { header, totals, user }, invNomor, idrec);

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

/**
 * Mengubah angka menjadi format teks Rupiah.
 * Contoh: 12345 -> "dua belas ribu tiga ratus empat puluh lima"
 */
function terbilang(n) {
    if (n === null || n === undefined || isNaN(n)) return "Nol";
    n = Math.floor(Math.abs(n));

    const ang = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];

    const terbilangRecursive = (num) => {
        if (num < 12) return ang[num];
        if (num < 20) return terbilangRecursive(num - 10) + " belas";
        if (num < 100) return (ang[Math.floor(num / 10)] || "") + " puluh " + terbilangRecursive(num % 10);
        if (num < 200) return "seratus " + terbilangRecursive(num - 100);
        if (num < 1000) return terbilangRecursive(Math.floor(num / 100)) + " ratus " + terbilangRecursive(num % 100);
        if (num < 2000) return "seribu " + terbilangRecursive(num - 1000);
        if (num < 1000000) return terbilangRecursive(Math.floor(num / 1000)) + " ribu " + terbilangRecursive(num % 1000);
        if (num < 1000000000) return terbilangRecursive(Math.floor(num / 1000000)) + " juta " + terbilangRecursive(n % 1000000);
        return "angka terlalu besar";
    };

    return terbilangRecursive(n).replace(/\s+/g, ' ').trim();
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '');

const getPrintData = async (nomor) => {
    // Query ini diadaptasi dari query 'cetak' di Delphi Anda
    const query = `
        SELECT 
            h.inv_nomor, h.inv_tanggal, h.inv_nomor_so, h.inv_top, h.inv_ket, h.inv_sc,
            h.inv_disc, h.inv_ppn, h.inv_bkrm, h.inv_dp, h.inv_pundiamal,
            h.inv_rptunai, h.inv_rpcard, h.inv_rpvoucher,
            DATE_ADD(h.inv_tanggal, INTERVAL h.inv_top DAY) AS tempo,
            c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp,
            d.invd_kode, d.invd_ukuran, d.invd_jumlah, d.invd_harga, d.invd_diskon,
            COALESCE(
                TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)),
                f.sd_nama
            ) AS nama_barang,
            (d.invd_jumlah * (d.invd_harga - d.invd_diskon)) AS total,
            h.user_create, DATE_FORMAT(h.date_create, "%d-%m-%Y %T") AS created,
            src.gdg_inv_nama AS perush_nama,
            src.gdg_inv_alamat AS perush_alamat,
            src.gdg_inv_telp AS perush_telp,
            src.gdg_inv_instagram,
            src.gdg_inv_fb
        FROM tinv_hdr h
        LEFT JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
        LEFT JOIN tbarangdc a ON a.brg_kode = d.invd_kode
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.invd_kode
        LEFT JOIN tgudang src ON src.gdg_kode = LEFT(h.inv_nomor, 3)
        WHERE h.inv_nomor = ?
        ORDER BY d.invd_nourut;
    `;

    const [rows] = await pool.query(query, [nomor]);
    if (rows.length === 0) throw new Error('Data Invoice tidak ditemukan.');

    // --- PENGOLAHAN DATA ---
    const header = { ...rows[0] };
    

    // Ini adalah bagian yang sebelumnya placeholder, sekarang sudah diisi lengkap
    const details = rows.map(row => ({
        invd_kode: row.invd_kode,
        nama_barang: row.nama_barang,
        invd_ukuran: row.invd_ukuran,
        invd_jumlah: row.invd_jumlah,
        invd_harga: row.invd_harga,
        invd_diskon: row.invd_diskon,
        total: row.total,
    }));
    // --- AKHIR PENGOLAHAN ---

    // Kalkulasi summary dari header dan detail
    const subTotal = details.reduce((sum, item) => sum + item.total, 0);
    const diskonFaktur = header.inv_disc || 0;
    const netto = subTotal - diskonFaktur;
    const ppn = (header.inv_ppn / 100) * netto;
    const grandTotal = netto + ppn + (header.inv_bkrm || 0);
    const totalBayar = (header.inv_rptunai || 0) + (header.inv_rpcard || 0) + (header.inv_rpvoucher || 0);

    header.summary = {
        subTotal,
        diskon: diskonFaktur,
        netto,
        ppn,
        biayaKirim: header.inv_bkrm || 0,
        dp: header.inv_dp || 0,
        grandTotal,
        bayar: totalBayar,
        pundiAmal: header.inv_pundiamal,
        kembali: totalBayar - (grandTotal - (header.inv_dp || 0))
    };
    header.terbilang = capitalize(terbilang(header.summary.grandTotal)) + " Rupiah";

    return { header, details };
};

const generateKuponNumber = async (connection, cabang, tanggal) => {
    const date = new Date(tanggal);
    // Asumsi tidak dalam mode 'BAZAR' untuk penyederhanaan
    const prefix = `${cabang}${format(date, 'yy')}`;
    const query = `
        SELECT IFNULL(MAX(RIGHT(invk_kupon, 5)), 0) + 1 AS next_num
        FROM tinv_kupon 
        WHERE invk_kupon LIKE ?;
    `;
    const [rows] = await connection.query(query, [`${prefix}%`]);
    const nextNumber = rows[0].next_num.toString().padStart(5, '0');

    return `${prefix}${nextNumber}`; // Contoh hasil: K012500001
};

const generateVoucherNumber = (invNomor, index) => {
    // Asumsi tidak dalam mode 'BAZAR'
    const rightPart = parseInt(invNomor.slice(-4));
    const middlePart = invNomor.substring(8, 12); // Mengambil bagian yymm

    if (index === 0) {
        return `V${middlePart}${rightPart}`; // Contoh hasil: V25091
    } else {
        return `V${middlePart}${rightPart}${index}`; // Contoh hasil: V250911
    }
};

const handlePromotions = async (connection, { header, totals, user }, invNomor, idrec) => {
    // Hapus kupon lama jika ada (untuk mode edit)
    await connection.query('DELETE FROM tinv_kupon WHERE invk_inv_nomor = ?', [invNomor]);

    // 1. Ambil semua promo yang aktif untuk cabang dan tanggal ini
    const promoQuery = `
        SELECT p.*
        FROM tpromo p
        INNER JOIN tpromo_cabang c ON c.pc_nomor = p.pro_nomor AND c.pc_cab = ?
        WHERE ? BETWEEN p.pro_tanggal1 AND p.pro_tanggal2;
    `;
    const [activePromos] = await connection.query(promoQuery, [user.cabang, header.tanggal]);

    if (activePromos.length === 0) return; // Tidak ada promo aktif

    const kuponToInsert = [];

    for (const promo of activePromos) {
        let qtyBonus = 0;

        // 2. Cek apakah syarat promo terpenuhi (berdasarkan total belanja)
        if (totals.nettoSetelahDiskon >= promo.pro_totalrp) {
            qtyBonus = promo.pro_lipat === 'Y' 
                ? Math.floor(totals.nettoSetelahDiskon / promo.pro_totalrp) 
                : 1;
        }
        // (Bisa ditambahkan pengecekan lain seperti pro_jenis=2 untuk total qty)

        if (qtyBonus > 0) {
            // 3. Generate kupon/voucher jika syarat terpenuhi
            for (let i = 0; i < qtyBonus; i++) {
                let kuponNomor = '';
                if (promo.pro_generate === 'K' && promo.pro_jenis_kupon === 'UNDIAN') { // Generate Kupon
                    kuponNomor = await generateKuponNumber(connection, user.cabang, header.tanggal);
                } else if (promo.pro_generate === 'V') { // Generate Voucher
                    kuponNomor = generateVoucherNumber(invNomor, i);
                } else if (promo.pro_generate === 'K' && promo.pro_jenis_kupon === 'BELANJA') {
                    kuponNomor = generateVoucherNumber(invNomor, i); // Menggunakan format yang sama
                }

                if (kuponNomor) {
                    kuponToInsert.push([
                        idrec, invNomor, kuponNomor, promo.pro_nomor,
                        promo.pro_ket, promo.pro_note, promo.pro_cetak_kupon,
                        promo.pro_rpvoucher, qtyBonus
                    ]);
                }
            }
        }
    }

    // 4. Insert semua kupon/voucher yang baru dibuat ke database
    if (kuponToInsert.length > 0) {
        const kuponSql = `
            INSERT INTO tinv_kupon (invk_idrec, invk_inv_nomor, invk_kupon, invk_promo, invk_ket, invk_note, invk_cetak, invk_nominal, invk_qty) 
            VALUES ?`;
        await connection.query(kuponSql, [kuponToInsert]);
    }
};

const findByBarcode = async (barcode, gudang) => {
    const query = `
        SELECT
            d.brgd_barcode AS barcode,
            d.brgd_kode AS kode,
            TRIM(CONCAT(h.brg_jeniskaos, " ", h.brg_tipe, " ", h.brg_lengan, " ", h.brg_jeniskain, " ", h.brg_warna)) AS nama,
            d.brgd_ukuran AS ukuran,
            d.brgd_harga AS harga,
            
            -- Logika perhitungan stok dari Delphi menggunakan tmasterstok --
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
          AND h.brg_logstok <> 'N'
          AND d.brgd_barcode = ?;
    `;

    // Parameter 'gudang' sekarang digunakan untuk subquery stok
    const [rows] = await pool.query(query, [gudang, barcode]);

    if (rows.length === 0) {
        throw new Error('Barcode tidak ditemukan atau barang tidak aktif.');
    }
    return rows[0];
};

const searchProducts = async (filters, user) => {
    const { term, page, itemsPerPage } = filters;
    const offset = (Number(page) - 1) * Number(itemsPerPage);
    const searchTerm = `%${term || ''}%`;

    let params = [];
    let baseFrom = `
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
    `;
    let baseWhere = `WHERE a.brg_aktif = 0`;

    // Logika filter cabang dari Delphi
    if (user.cabang === 'K04') {
        baseWhere += ' AND a.brg_ktg <> ""';
    } else if (user.cabang === 'K05') {
        baseWhere += ' AND a.brg_ktg = ""';
    }

    // Filter pencarian
    const searchWhere = `AND (b.brgd_kode LIKE ? OR b.brgd_barcode LIKE ? OR TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) LIKE ?)`;
    params.push(searchTerm, searchTerm, searchTerm);

    const countQuery = `SELECT COUNT(*) AS total ${baseFrom} ${baseWhere} ${searchWhere}`;
    const [countRows] = await pool.query(countQuery, params);

    const dataQuery = `
        SELECT
            b.brgd_kode AS kode,
            b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            b.brgd_harga AS harga,
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m 
                WHERE m.mst_aktif = 'Y' AND m.mst_cab = ? AND m.mst_brg_kode = b.brgd_kode AND m.mst_ukuran = b.brgd_ukuran
            ), 0) AS stok
        ${baseFrom} ${baseWhere} ${searchWhere}
        ORDER BY nama, b.brgd_ukuran
        LIMIT ? OFFSET ?;
    `;
    const dataParams = [user.cabang, ...params, Number(itemsPerPage), offset];
    const [items] = await pool.query(dataQuery, dataParams);

    return { items, total: countRows[0].total };
};

const generateNewSetorNumber = async (connection, cabang, tanggal) => {
    const date = new Date(tanggal);
    const prefix = `${cabang}.STR.${format(date, 'yyMM')}.`;
    const query = `
        SELECT IFNULL(MAX(RIGHT(sh_nomor, 4)), 0) + 1 AS next_num
        FROM tsetor_hdr 
        WHERE sh_nomor LIKE ?;
    `;
    // Gunakan koneksi dari transaksi agar konsisten
    const [rows] = await connection.query(query, [`${prefix}%`]);
    const nextNumber = rows[0].next_num.toString().padStart(4, '0');
    return `${prefix}${nextNumber}`;
};

const getPrintDataKasir = async (nomor) => {
    const query = `
        SELECT 
            h.inv_nomor, h.inv_tanggal, h.inv_nomor_so, h.inv_top, h.inv_ket, h.inv_sc,
            h.inv_disc, h.inv_ppn, h.inv_bkrm, h.inv_dp, h.inv_pundiamal,
            h.inv_rptunai, h.inv_rpcard, h.inv_rpvoucher,
            DATE_ADD(h.inv_tanggal, INTERVAL h.inv_top DAY) AS tempo,
            c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp,
            d.invd_kode, d.invd_ukuran, d.invd_jumlah, d.invd_harga, d.invd_diskon,
            COALESCE(
                TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)),
                f.sd_nama
            ) AS nama_barang,
            (d.invd_jumlah * (d.invd_harga - d.invd_diskon)) AS total,
            h.user_create, DATE_FORMAT(h.date_create, "%d-%m-%Y %T") AS created,
            src.gdg_inv_nama AS perush_nama,
            src.gdg_inv_alamat AS perush_alamat,
            src.gdg_inv_telp AS perush_telp,
            src.gdg_inv_instagram,
            src.gdg_inv_fb
        FROM tinv_hdr h
        LEFT JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
        LEFT JOIN tbarangdc a ON a.brg_kode = d.invd_kode
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.invd_kode
        LEFT JOIN tgudang src ON src.gdg_kode = LEFT(h.inv_nomor, 3)
        WHERE h.inv_nomor = ?
        ORDER BY d.invd_nourut;
    `;

    const [rows] = await pool.query(query, [nomor]);
    if (rows.length === 0) throw new Error('Data Invoice tidak ditemukan.');

    // --- PENGOLAHAN DATA ---
    const header = { ...rows[0] };

    // Ini adalah bagian yang sebelumnya placeholder, sekarang sudah diisi lengkap
    const details = rows.map(row => ({
        invd_kode: row.invd_kode,
        nama_barang: row.nama_barang,
        invd_ukuran: row.invd_ukuran,
        invd_jumlah: row.invd_jumlah,
        invd_harga: row.invd_harga,
        invd_diskon: row.invd_diskon,
        total: row.total,
    }));
    // --- AKHIR PENGOLAHAN ---

    // Kalkulasi summary dari header dan detail
    const subTotal = details.reduce((sum, item) => sum + item.total, 0);
    const diskonFaktur = header.inv_disc || 0;
    const netto = subTotal - diskonFaktur;
    const ppn = (header.inv_ppn / 100) * netto;
    const grandTotal = netto + ppn + (header.inv_bkrm || 0);
    const totalBayar = (header.inv_rptunai || 0) + (header.inv_rpcard || 0) + (header.inv_rpvoucher || 0);

    header.summary = {
        subTotal,
        diskon: diskonFaktur,
        netto,
        ppn,
        biayaKirim: header.inv_bkrm || 0,
        dp: header.inv_dp || 0,
        grandTotal,
        bayar: totalBayar,
        pundiAmal: header.inv_pundiamal,
        kembali: totalBayar - (grandTotal - (header.inv_dp || 0))
    };
    header.terbilang = capitalize(terbilang(header.summary.grandTotal)) + " Rupiah";

    return { header, details };
};

const searchSoDtf = async (filters, user) => {
    const { term, customerKode } = filters;
    const searchTerm = `%${term || ''}%`;
    
    const query = `
        SELECT h.sd_nomor AS nomor, h.sd_tanggal AS tanggal, h.sd_nama AS namaDtf, h.sd_ket AS keterangan
        FROM tsodtf_hdr h
        WHERE h.sd_stok = "" AND h.sd_alasan = "" 
          AND LEFT(h.sd_nomor, 3) = ?
          AND h.sd_cus_kode = ?
          AND h.sd_nomor NOT IN (
              SELECT DISTINCT sod_sd_nomor FROM tso_dtl WHERE sod_sd_nomor <> ''
              UNION ALL
              SELECT DISTINCT invd_sd_nomor FROM tinv_dtl WHERE invd_sd_nomor <> ''
          )
          AND (h.sd_nomor LIKE ? OR h.sd_nama LIKE ?);
    `;
    const [rows] = await pool.query(query, [user.cabang, customerKode, searchTerm, searchTerm]);
    return rows;
};

const getSoDtfDetails = async (nomor) => {
    // Query ini mengambil semua baris detail dari SO DTF terpilih
    const query = `
        SELECT 
            h.sd_nomor AS kode,
            h.sd_nama AS nama,
            d.sdd_ukuran AS ukuran,
            d.sdd_jumlah AS jumlah,
            d.sdd_harga AS harga
        FROM tsodtf_dtl d
        LEFT JOIN tsodtf_hdr h ON h.sd_nomor = d.sdd_nomor
        WHERE d.sdd_nomor = ?
        ORDER BY d.sdd_nourut;
    `;
    const [rows] = await pool.query(query, [nomor]);
    return rows;
};

const searchReturJual = async (filters, user) => {
    const { customerKode, invoiceNomor } = filters;
    
    // Query ini diadaptasi dari sqlbantuan di edtrjKeyDown Delphi
    const query = `
        SELECT x.Nomor, x.Tanggal, x.Nominal, (x.Nominal - x.Link) AS Sisa
        FROM (
            SELECT 
                h.rj_nomor AS Nomor,
                h.rj_tanggal AS Tanggal,
                h.rj_inv AS Invoice,
                (SELECT ROUND(SUM(d.rjd_jumlah*d.rjd_harga)-h.rj_disc+(h.rj_ppn/100*(SUM(d.rjd_jumlah*d.rjd_harga)-h.rj_disc))) FROM trj_dtl d WHERE d.rjd_nomor = h.rj_nomor) AS Nominal,
                IFNULL((SELECT SUM(p.pd_kredit) FROM tpiutang_dtl p WHERE p.pd_ket = h.rj_nomor AND p.pd_ph_nomor <> CONCAT(?,?)), 0) AS link
            FROM trj_hdr h
            WHERE LEFT(h.rj_nomor, 3) = ?
              AND h.rj_cus_kode = ?
              AND h.rj_inv <> ?
        ) x
        WHERE x.Link = 0 AND (x.Nominal - x.Link) > 0;
    `;
    const params = [customerKode, invoiceNomor, user.cabang, customerKode, invoiceNomor];
    const [rows] = await pool.query(query, params);
    return rows;
};

const saveSatisfaction = async ({ nomor, rating }) => {
    // Query untuk UPDATE tinv_hdr SET inv_puas = ? WHERE inv_nomor = ?
    await pool.query('UPDATE tinv_hdr SET inv_puas = ? WHERE inv_nomor = ?', [rating, nomor]);
    return { message: 'Terima kasih atas masukan Anda.' };
};

const getDiscountRule = async (customerKode) => {
    if (!customerKode) return null;
    
    // Ambil level terakhir yang aktif dari customer
    const query = `
        SELECT 
            h.clh_level AS level_kode,
            l.level_diskon AS diskon1,
            l.level_diskon2 AS diskon2,
            l.level_nominal AS nominal1,
            l.level_nominal2 AS nominal2
        FROM tcustomer_level_history h
        JOIN tcustomer_level l ON l.level_kode = h.clh_level
        WHERE h.clh_cus_kode = ?
        ORDER BY h.clh_tanggal DESC
        LIMIT 1;
    `;
    const [rows] = await pool.query(query, [customerKode]);
    return rows[0]; // Akan undefined jika tidak ada level
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
    getPrintData,
    findByBarcode,
    searchProducts,
    getPrintDataKasir,
    searchSoDtf,
    getSoDtfDetails,
    searchReturJual,
    saveSatisfaction,
    getDiscountRule,
};

