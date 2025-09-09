const pool = require('../config/database');
const { format, addDays } = require('date-fns');

// Meniru fungsi getmaxnomor
const generateNewOfferNumber = async (connection, cabang, tanggal) => {
    // 'tanggal' yang masuk ke sini adalah string, contoh: "2025-09-09"

    // --- PERBAIKAN ---
    // Kita ambil langsung dari string 'yyyy-MM-dd' tanpa perlu parsing
    const yearPart = tanggal.substring(2, 4); // Mengambil '25' dari '2025-09-09'
    const monthPart = tanggal.substring(5, 7); // Mengambil '09' dari '2025-09-09'
    const datePrefix = yearPart + monthPart; // Hasilnya menjadi '2509'

    const prefix = `${cabang}.PEN.${datePrefix}`;
    const query = `
        SELECT IFNULL(MAX(CAST(RIGHT(pen_nomor, 4) AS UNSIGNED)), 0) as maxNum 
        FROM tpenawaran_hdr 
        WHERE LEFT(pen_nomor, ${prefix.length}) = ?
    `;
    const [rows] = await connection.query(query, [prefix]);
    const nextNum = rows[0].maxNum + 1;
    return `${prefix}.${String(nextNum).padStart(4, '0')}`;
};

// Meniru F1 untuk pencarian customer
const searchCustomers = async (term, gudang, page, itemsPerPage) => {
    const offset = (page - 1) * itemsPerPage;
    const searchTerm = `%${term}%`;
    let params = [];
    
    // Logika filter franchise dari Delphi
    let franchiseFilter = '';
    if (gudang === 'KPR') {
        franchiseFilter = ' AND c.cus_franchise="Y"';
    } else {
        franchiseFilter = ' AND c.cus_franchise="N"';
    }

    let searchFilter = '';
    if (term) {
        searchFilter = ' AND (c.cus_kode LIKE ? OR c.cus_nama LIKE ?)';
        params.push(searchTerm, searchTerm);
    }
    
    const baseQuery = `
        FROM tcustomer c 
        WHERE c.cus_aktif = 0 AND c.cus_nama NOT LIKE "RETAIL%"
        ${franchiseFilter}
        ${searchFilter}
    `;

    // Query untuk menghitung total
    const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;
    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0].total;

    // Query untuk mengambil data per halaman, ditambahkan kolom "Level"
    const dataQuery = `
        SELECT 
            c.cus_kode AS kode,
            c.cus_nama AS nama,
            c.cus_alamat AS alamat,
            c.cus_kota AS kota,
            IFNULL((
                SELECT l.level_nama
                FROM tcustomer_level_history v
                LEFT JOIN tcustomer_level l ON l.level_kode = v.clh_level
                WHERE v.clh_cus_kode = c.cus_kode
                ORDER BY v.clh_tanggal DESC LIMIT 1
            ), "") AS level
        ${baseQuery}
        ORDER BY c.cus_nama
        LIMIT ? OFFSET ?
    `;
    const [items] = await pool.query(dataQuery, [...params, itemsPerPage, offset]);

    return { items, total };
};

// Meniru edtCusExit untuk mengambil detail customer
const getCustomerDetails = async (kode) => {
    const query = `
        SELECT 
            c.cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp, c.cus_top, c.cus_franchise,
            IFNULL(CONCAT(x.clh_level, " - " ,x.level_nama), "") AS xlevel,
            lvl.level_diskon, lvl.level_diskon2, lvl.level_nominal
        FROM tcustomer c
        LEFT JOIN (
            SELECT i.clh_cus_kode, i.clh_level, l.level_nama FROM tcustomer_level_history i 
            LEFT JOIN tcustomer_level l ON l.level_kode = i.clh_level
            WHERE i.clh_cus_kode = ? ORDER BY i.clh_tanggal DESC LIMIT 1
        ) x ON x.clh_cus_kode = c.cus_kode
        LEFT JOIN tcustomer_level lvl ON lvl.level_kode = x.clh_level
        WHERE c.cus_kode = ?;
    `;
    const [rows] = await pool.query(query, [kode, kode]);
    if (rows.length === 0) {
        throw { status: 404, message: 'Customer tidak ada di database.' };
    }

    const customer = rows[0];
    return {
        kode: customer.cus_kode,
        nama: customer.cus_nama,
        alamat: customer.cus_alamat,
        kota: customer.cus_kota,
        telp: customer.cus_telp,
        top: customer.cus_top,
        level: customer.xlevel,
        discountRule: { // Kirim aturan diskon ke frontend
            diskon1: customer.level_diskon,
            diskon2: customer.level_diskon2,
            nominal: customer.level_nominal
        }
    };
};

/**
 * @description Menyimpan data Penawaran (Baru & Ubah).
 */
const saveOffer = async (data) => {
    const { header, footer, details, user, isNew } = data;
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        let nomorPenawaran = header.nomor;
        let idrec;

        // 1. Tentukan nomor & simpan/update data Header
        if (isNew) {
            nomorPenawaran = await generateNewOfferNumber(connection, header.gudang.kode, header.tanggal);
            
            // MEMBUAT IDREC SEPERTI DI DELPHI
            idrec = `${header.gudang.kode}PEN${format(new Date(), 'yyyyMMddHHmmssSSS')}`;

            const insertHeaderQuery = `
                INSERT INTO tpenawaran_hdr 
                (pen_idrec, pen_nomor, pen_tanggal, pen_top, pen_ppn, pen_disc, pen_disc1, pen_disc2, pen_bkrm, pen_cus_kode, pen_cus_level, pen_ket, user_create, date_create) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `;
            await connection.query(insertHeaderQuery, [
                idrec, // <-- TAMBAHKAN nilai idrec
                nomorPenawaran, header.tanggal, header.top, header.ppnPersen, 
                footer.diskonRp, footer.diskonPersen1, footer.diskonPersen2, footer.biayaKirim,
                header.customer.kode, header.customer.level.split(' - ')[0], header.keterangan, user.kode
            ]);
        } else {
            // Untuk mode edit, kita perlu mengambil idrec yang sudah ada
            const [idrecRows] = await connection.query('SELECT pen_idrec FROM tpenawaran_hdr WHERE pen_nomor = ?', [nomorPenawaran]);
            if (idrecRows.length === 0) throw new Error('Nomor penawaran untuk diupdate tidak ditemukan.');
            idrec = idrecRows[0].pen_idrec;
            
            const updateHeaderQuery = `
                UPDATE tpenawaran_hdr SET
                pen_tanggal = ?, pen_top = ?, pen_ppn = ?, pen_disc = ?, pen_disc1 = ?, pen_disc2 = ?, pen_bkrm = ?,
                pen_cus_kode = ?, pen_cus_level = ?, pen_ket = ?, user_modified = ?, date_modified = NOW()
                WHERE pen_nomor = ?
            `;
            await connection.query(updateHeaderQuery, [
                header.tanggal, header.top, header.ppnPersen, footer.diskonRp, footer.diskonPersen1, footer.diskonPersen2, footer.biayaKirim,
                header.customer.kode, header.customer.level.split(' - ')[0], header.keterangan, user.kode,
                nomorPenawaran
            ]);
        }

        // 2. Hapus detail lama
        await connection.query('DELETE FROM tpenawaran_dtl WHERE pend_nomor = ?', [nomorPenawaran]);

        // 3. Sisipkan detail baru
        for (const [index, item] of details.entries()) {
            const insertDetailQuery = `
                INSERT INTO tpenawaran_dtl
                (pend_idrec, pend_nomor, pend_kode, pend_ph_nomor, pend_sd_nomor, pend_ukuran, pend_jumlah, pend_harga, pend_disc, pend_diskon, pend_nourut)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            await connection.query(insertDetailQuery, [
                idrec, // <-- GUNAKAN idrec yang sama untuk detail
                nomorPenawaran, item.kode, item.noPengajuanHarga, item.noSoDtf, item.ukuran,
                item.jumlah, item.harga, item.diskonPersen, item.diskonRp, index + 1
            ]);
        }

        await connection.commit();
        return { success: true, message: `Penawaran ${nomorPenawaran} berhasil disimpan.` };
    } catch (error) {
        await connection.rollback();
        console.error("Error in saveOffer service:", error); 
        throw new Error('Terjadi kesalahan saat menyimpan data di server.');
    } finally {
        connection.release();
    }
};

const getDefaultDiscount = async (level, total, gudang) => {
    let discount = 0;
    
    // Meniru logika if edtgdgkode.Text='KPR'
    if (gudang === 'KPR') {
        discount = 15;
    } else {
        const query = 'SELECT * FROM tcustomer_level WHERE level_kode = ?';
        const [levelRows] = await pool.query(query, [level]);

        if (levelRows.length > 0) {
            const levelData = levelRows[0];
            if (total >= levelData.level_nominal) {
                discount = levelData.level_diskon;
            } else {
                discount = levelData.level_diskon2;
            }
        }
    }
    return { discount };
};

/**
 * Mengambil semua data yang diperlukan untuk mode "Ubah Penawaran".
 */
const getOfferForEdit = async (nomor) => {
    // 1. Ambil data Header
    // Perbaikan: Query ditulis ulang untuk menghindari error "Unknown Column"
    const headerQuery = `
        SELECT 
            h.pen_nomor AS nomor, h.pen_tanggal AS tanggal, h.pen_top AS top, 
            h.pen_ppn AS ppnPersen, h.pen_ket AS keterangan, h.pen_disc1, h.pen_disc2, h.pen_bkrm,
            c.cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp,
            (
                SELECT IFNULL(CONCAT(clh_level, " - " ,level_nama), "")
                FROM tcustomer_level_history v 
                LEFT JOIN tcustomer_level l ON l.level_kode = v.clh_level
                WHERE v.clh_cus_kode = h.pen_cus_kode 
                ORDER BY v.clh_tanggal DESC LIMIT 1
            ) AS xlevel,
            g.gdg_kode, g.gdg_nama
        FROM tpenawaran_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
        LEFT JOIN tgudang g ON g.gdg_kode = LEFT(h.pen_nomor, 3)
        WHERE h.pen_nomor = ?;
    `;
    const [headerRows] = await pool.query(headerQuery, [nomor]);
    if (headerRows.length === 0) {
        throw { status: 404, message: `Penawaran dengan nomor ${nomor} tidak ditemukan.` };
    }

    const headerData = {
        nomor: headerRows[0].nomor,
        tanggal: format(new Date(headerRows[0].tanggal), 'yyyy-MM-dd'),
        gudang: { kode: headerRows[0].gdg_kode, nama: headerRows[0].gdg_nama },
        customer: {
            kode: headerRows[0].cus_kode,
            nama: headerRows[0].cus_nama,
            alamat: headerRows[0].cus_alamat,
            kota: headerRows[0].cus_kota,
            telp: headerRows[0].cus_telp,
            top: headerRows[0].top,
            level: headerRows[0].xlevel,
        },
        top: headerRows[0].top,
        tempo: format(addDays(new Date(headerRows[0].tanggal), headerRows[0].top), 'yyyy-MM-dd'),
        ppnPersen: headerRows[0].ppnPersen,
        keterangan: headerRows[0].keterangan,
    };

    // 2. Ambil data Detail (Items)
    const itemsQuery = `
        SELECT 
            d.pend_kode AS kode, IFNULL(b.brgd_barcode, "") AS barcode,
            IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe)), "") AS nama,
            d.pend_ukuran AS ukuran, d.pend_jumlah AS jumlah, d.pend_harga AS harga,
            d.pend_disc AS diskonPersen, d.pend_diskon AS diskonRp,
            (d.pend_jumlah * (d.pend_harga - d.pend_diskon)) as total
        FROM tpenawaran_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.pend_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.pend_kode AND b.brgd_ukuran = d.pend_ukuran
        WHERE d.pend_nomor = ? ORDER BY d.pend_nourut;
    `;
    const [itemsData] = await pool.query(itemsQuery, [nomor]);

    // 3. Ambil data Footer
    const footerData = {
        diskonPersen1: headerRows[0].pen_disc1 || 0,
        diskonPersen2: headerRows[0].pen_disc2 || 0,
        biayaKirim: headerRows[0].pen_bkrm || 0,
    };

    return { headerData, itemsData, footerData };
};

module.exports = {
    generateNewOfferNumber,
    searchCustomers,
    getCustomerDetails,
    saveOffer,
    getDefaultDiscount,
    getOfferForEdit,
};
