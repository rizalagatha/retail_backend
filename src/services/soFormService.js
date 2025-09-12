const pool = require('../config/database');
const { format } = require('date-fns');
const { get } = require('../routes/salesCounterRoute');

/**
 * @description Membuat nomor SO baru (getmaxnomor).
 */
const generateNewSoNumber = async (connection, cabang, tanggal) => {
    const datePrefix = format(new Date(tanggal), 'yyMM');
    const prefix = `${cabang}.SO.${datePrefix}`;
    const [rows] = await connection.query(`SELECT IFNULL(MAX(RIGHT(so_nomor, 4)), 0) as maxNum FROM tso_hdr WHERE LEFT(so_nomor, ${prefix.length}) = ?`, [prefix]);
    const nextNum = parseInt(rows[0].maxNum, 10) + 1;
    return `${prefix}.${String(10000 + nextNum).slice(1)}`;
};

/**
 * @description Menyimpan data SO (simpandata).
 */
const save = async (data, user) => {
    const { header, footer, details, dps, isNew } = data;
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
        let soNomor = header.nomor;
        let idrec;
        const aktifStatus = header.statusSo === 'AKTIF' ? 'Y' : 'N';

        // 1. Tentukan nomor & simpan/update data Header
        if (isNew) {
            soNomor = await generateNewSoNumber(connection, header.gudang.kode, header.tanggal);
            idrec = `${header.gudang.kode}SO${format(new Date(), 'yyyyMMddHHmmssSSS')}`;

            const insertHeaderQuery = `
                INSERT INTO tso_hdr 
                (so_idrec, so_nomor, so_tanggal, so_dateline, so_pen_nomor, so_top, so_ppn, so_disc, so_disc1, so_disc2, so_bkrm, so_dp, so_cus_kode, so_cus_level, so_accdp, so_ket, so_aktif, so_sc, user_create, date_create) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `;
            await connection.query(insertHeaderQuery, [
                idrec, soNomor, header.tanggal, header.dateline, header.penawaran, header.top || 0, header.ppnPersen || 0,
                footer.diskonRp, footer.diskonPersen1, footer.diskonPersen2, footer.biayaKirim, footer.totalDp,
                header.customer.kode, header.level, footer.pinTanpaDp, header.keterangan, aktifStatus, header.salesCounter, user.kode
            ]);
        } else {
            const [idrecRows] = await connection.query('SELECT so_idrec FROM tso_hdr WHERE so_nomor = ?', [soNomor]);
            if (idrecRows.length === 0) throw new Error('Nomor SO untuk diupdate tidak ditemukan.');
            idrec = idrecRows[0].so_idrec;

            const updateHeaderQuery = `
                UPDATE tso_hdr SET
                so_cus_kode = ?, so_pen_nomor = ?, so_cus_level = ?, so_tanggal = ?, so_dateline = ?, so_top = ?, so_ppn = ?, so_accdp = ?, so_ket = ?,
                so_disc = ?, so_disc1 = ?, so_disc2 = ?, so_bkrm = ?, so_dp = ?, so_aktif = ?, so_sc = ?, user_modified = ?, date_modified = NOW()
                WHERE so_nomor = ?
            `;
            await connection.query(updateHeaderQuery, [
                header.customer.kode, header.penawaran, header.level, header.tanggal, header.dateline, header.top || 0, header.ppnPersen || 0, footer.pinTanpaDp, header.keterangan,
                footer.diskonRp, footer.diskonPersen1, footer.diskonPersen2, footer.biayaKirim, footer.totalDp, aktifStatus, header.salesCounter, user.kode,
                soNomor
            ]);
        }

        // 2. Hapus detail lama dan sisipkan yang baru
        await connection.query('DELETE FROM tso_dtl WHERE sod_so_nomor = ?', [soNomor]);
        for (const [index, item] of details.entries()) {
            const insertDetailQuery = `
                INSERT INTO tso_dtl (sod_idrec, sod_so_nomor, sod_kode, sod_ph_nomor, sod_sd_nomor, sod_ukuran, sod_jumlah, sod_harga, sod_disc, sod_diskon, sod_nourut) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            await connection.query(insertDetailQuery, [
                idrec, soNomor, item.kode, item.noPengajuanHarga || '', item.noSoDtf || '', item.ukuran,
                item.jumlah, item.harga, item.diskonPersen, item.diskonRp, index + 1
            ]);
        }

        // 3. Simpan PIN Otorisasi (logika simpanpin)
        for (const item of details) {
            if (item.pin) {
                await connection.query('INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_barcode, o_created, o_pin, o_nominal) VALUES (?, "SO", "DISKON ITEM", ?, NOW(), ?, ?)', [soNomor, item.barcode || '', item.pin, item.diskonPersen]);
            }
        }
        if (footer.pinDiskon1) {
            await connection.query('INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_created, o_pin, o_nominal) VALUES (?, "SO", "DISKON FAKTUR", NOW(), ?, ?)', [soNomor, footer.pinDiskon1, footer.diskonPersen1]);
        }
        if (footer.pinDiskon2) {
            await connection.query('INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_created, o_pin, o_nominal) VALUES (?, "SO", "DISKON FAKTUR 2", NOW(), ?, ?)', [soNomor, footer.pinDiskon2, footer.diskonPersen2]);
        }
        if (footer.pinTanpaDp) {
            await connection.query('INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_created, o_pin, o_nominal) VALUES (?, "SO", "TANPA DP", NOW(), ?, ?)', [soNomor, footer.pinTanpaDp, footer.belumDibayar]);
        }

        // 4. Update nomor SO di setoran (logika simpannoso)
        if (dps && dps.length > 0) {
            const noSetoran = dps.map(dp => dp.nomor);
            await connection.query('UPDATE tsetor_hdr SET sh_so_nomor = ? WHERE sh_nomor IN (?)', [soNomor, noSetoran]);
        }

        await connection.commit();
        return { message: `Surat Pesanan ${soNomor} berhasil disimpan.`, nomor: soNomor };
    } catch (error) {
        await connection.rollback();
        console.error("Save SO Error:", error);
        throw new Error('Gagal menyimpan Surat Pesanan.');
    } finally {
        connection.release();
    }
};

/**
 * @description Memuat semua data untuk mode Ubah (loaddataall).
 */
const getSoForEdit = async (nomor) => {
    const connection = await pool.getConnection();
    try {
        // 1. Cek jika SO sudah menjadi invoice
        const [invoiceRows] = await connection.query('SELECT inv_nomor FROM tinv_hdr WHERE inv_nomor_so = ?', [nomor]);
        const isInvoiced = invoiceRows.length > 0;

        // 2. Ambil data Header Utama & Detail Item dalam satu query
        const mainQuery = `
            SELECT 
                h.*, d.*, c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp,
                DATE_FORMAT(c.cus_tgllahir, "%d-%m-%Y") AS tgllahir,
                b.brgd_barcode,
                CONCAT(h.so_cus_level, " - ", l.level_nama) AS xLevel,
                IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe)), f.sd_nama) AS NamaBarang,
                (d.sod_jumlah * (d.sod_harga - d.sod_diskon)) AS total,
                IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif="Y" AND m.mst_cab=LEFT(h.so_nomor,3) AND m.mst_brg_kode=d.sod_kode AND m.mst_ukuran=d.sod_ukuran), 0) AS Stok
            FROM tso_hdr h
            JOIN tso_dtl d ON d.sod_so_nomor = h.so_nomor
            LEFT JOIN tbarangdc a ON a.brg_kode = d.sod_kode
            LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.sod_kode
            LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sod_kode AND b.brgd_ukuran = d.sod_ukuran
            LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
            LEFT JOIN tcustomer_level l ON l.level_kode = h.so_cus_level
            WHERE h.so_nomor = ?
            ORDER BY d.sod_nourut
        `;
        const [mainRows] = await connection.query(mainQuery, [nomor]);
        if (mainRows.length === 0) {
            throw new Error(`Surat Pesanan dengan nomor ${nomor} tidak ditemukan.`);
        }

        // 3. Ambil data DP
        const dpQuery = `
            SELECT 
                h.sh_nomor AS nomor,
                IF(h.sh_jenis=0, "TUNAI", IF(h.sh_jenis=1, "TRANSFER", "GIRO")) AS jenis,
                h.sh_nominal AS nominal,
                IF(j.jur_no IS NULL, "BELUM", "SUDAH") AS posting
            FROM tsetor_hdr h
            LEFT JOIN finance.tjurnal j ON j.jur_nomor = h.sh_nomor
            WHERE h.sh_otomatis = "N" AND h.sh_so_nomor = ?
        `;
        const [dpRows] = await connection.query(dpQuery, [nomor]);

        // 4. Proses dan format data untuk dikirim ke frontend
        const headerData = {
            nomor: mainRows[0].so_nomor,
            tanggal: mainRows[0].so_tanggal,
            dateline: mainRows[0].so_dateline,
            penawaran: mainRows[0].so_pen_nomor,
            keterangan: mainRows[0].so_ket,
            salesCounter: mainRows[0].so_sc,
            customer: {
                kode: mainRows[0].so_cus_kode,
                nama: mainRows[0].cus_nama,
                alamat: mainRows[0].cus_alamat,
                kota: mainRows[0].cus_kota,
                telp: mainRows[0].cus_telp,
            },
            levelKode: String(mainRows[0].so_cus_level || ''),   // paksa string ✅
            levelNama: mainRows[0].level_nama || '',             // simpan nama doang
            level: `${mainRows[0].so_cus_level} - ${mainRows[0].level_nama}`, // kalau masih mau gabungan
            top: mainRows[0].so_top,
            ppnPersen: mainRows[0].so_ppn,
            statusSo: mainRows[0].so_aktif === 'Y' ? 'AKTIF' : 'PASIF',
            canEdit: !isInvoiced // Kirim flag apakah form bisa diedit
        };

        const itemsData = mainRows.map(row => ({
            kode: row.sod_kode,
            nama: row.NamaBarang,
            ukuran: row.sod_ukuran,
            stok: row.Stok,
            jumlah: row.sod_jumlah,
            harga: row.sod_harga,
            diskonPersen: row.sod_disc,
            diskonRp: row.sod_diskon,
            total: row.total,
            barcode: row.brgd_barcode,
            noSoDtf: row.sod_sd_nomor,
            noPengajuanHarga: row.sod_ph_nomor,
        }));

        const footerData = {
            diskonRp: mainRows[0].so_disc,
            diskonPersen1: mainRows[0].so_disc1,
            diskonPersen2: mainRows[0].so_disc2,
            biayaKirim: mainRows[0].so_bkrm,
        };

        return { headerData, itemsData, dpItemsData: dpRows, footerData };
    } finally {
        connection.release();
    }
};

/**
 * @description Mencari Penawaran yang valid (belum jadi SO, belum di-close).
 */
const searchAvailablePenawaran = async (filters) => {
    const { cabang, customerKode, term } = filters;
    const searchTerm = `%${term}%`;
    const query = `
        SELECT 
            h.pen_nomor AS nomor,
            h.pen_tanggal AS tanggal,
            h.pen_cus_kode AS kdcus,
            c.cus_nama AS customer,
            v.level_nama AS level,
            c.cus_alamat AS alamat,
            h.pen_ket AS keterangan
        FROM tpenawaran_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
        LEFT JOIN tcustomer_level v ON v.level_kode = h.pen_cus_level
        WHERE h.pen_alasan = ""
          AND LEFT(h.pen_nomor, 3) = ?
          AND h.pen_cus_kode = ?
          AND h.pen_nomor NOT IN (SELECT so_pen_nomor FROM tso_hdr WHERE so_pen_nomor <> "")
          AND (h.pen_nomor LIKE ? OR c.cus_nama LIKE ?)
        ORDER BY h.pen_nomor DESC
    `;
    const [rows] = await pool.query(query, [cabang, customerKode, searchTerm, searchTerm]);
    return rows;
};

/**
 * @description Mengambil semua data dari Penawaran untuk diimpor ke SO.
 */
const getPenawaranDetailsForSo = async (nomor) => {
    // 1. Ambil Header
    const [headerRows] = await pool.query('SELECT * FROM tpenawaran_hdr WHERE pen_nomor = ?', [nomor]);
    if (headerRows.length === 0) throw new Error('Data Penawaran tidak ditemukan.');

    // 2. Ambil Detail
    const [detailRows] = await pool.query(`
        SELECT 
            d.pend_kode AS kode,
            IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe)), f.sd_nama) AS nama,
            d.pend_ukuran AS ukuran,
            d.pend_jumlah AS jumlah,
            d.pend_harga AS harga,
            d.pend_disc AS diskonPersen,
            d.pend_diskon AS diskonRp,
            (d.pend_jumlah * (d.pend_harga - d.pend_diskon)) AS total,
            b.brgd_barcode as barcode,
            d.pend_sd_nomor as noSoDtf,
            d.pend_ph_nomor as noPengajuanHarga
        FROM tpenawaran_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.pend_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.pend_kode AND b.brgd_ukuran = d.pend_ukuran
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.pend_kode
        WHERE d.pend_nomor = ? 
        ORDER BY d.pend_nourut
    `, [nomor]);

    return { header: headerRows[0], details: detailRows };
};

const getDefaultDiscount = async (level, total, gudang) => {
    let discount = 0;

    // Logika khusus untuk gudang KPR
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

const searchAvailableSetoran = async (filters) => {
    const { cabang, customerKode, soNomor, term } = filters;
    const searchTerm = `%${term}%`;
    const query = `
        SELECT x.Nomor, x.Tanggal, x.Jenis, x.Posting, x.Fsk, x.Nominal 
        FROM (
            SELECT 
                h.sh_nomor AS Nomor, h.sh_tanggal AS Tanggal, 
                IF(h.sh_jenis=0, "TUNAI", IF(h.sh_jenis=1, "TRANSFER", "GIRO")) AS Jenis, 
                h.sh_nominal AS Nominal,
                IFNULL((SELECT SUM(d.sd_bayar) FROM tsetor_dtl d WHERE d.sd_sh_nomor = h.sh_nomor), 0) AS Terpakai,
                IF(j.jur_no IS NULL, "BELUM", "SUDAH") AS Posting,
                IF(f.fskd_nomor IS NULL, "N", "Y") AS fsk
            FROM tsetor_hdr h
            LEFT JOIN tform_setorkasir_dtl f ON f.fskd_sh_nomor = h.sh_nomor
            LEFT JOIN finance.tjurnal j ON j.jur_nomor = h.sh_nomor
            WHERE h.sh_otomatis = "N" 
              AND (h.sh_so_nomor = "" OR h.sh_so_nomor = ?) 
              AND LEFT(h.sh_nomor, 3) = ? AND h.sh_cus_kode = ?
              AND h.sh_nomor LIKE ?
        ) x 
        WHERE (x.Nominal - x.Terpakai) > 0
    `;
    const [rows] = await pool.query(query, [soNomor, cabang, customerKode, searchTerm]);
    return rows;
};

/**
 * @description Membuat nomor Setoran DP baru (getmaxdp versi Delphi).
 */
const generateNewDpNumber = async (connection, cabang, tanggal) => {
    // Format tanggal ke 'yymm'
    const datePrefix = format(new Date(tanggal), 'yyMM');

    // Buat prefix lengkap, contoh: K01.STR.2509
    const prefix = `${cabang}.STR.${datePrefix}`;

    const query = `
        SELECT IFNULL(MAX(RIGHT(sh_nomor, 4)), 0) as lastNum 
        FROM tsetor_hdr 
        WHERE LEFT(sh_nomor, 12) = ?
    `;

    const [rows] = await connection.query(query, [prefix]);
    const lastNum = parseInt(rows[0].lastNum, 10);
    const newNum = lastNum + 1;

    // Format nomor urut menjadi 4 digit dengan padding nol
    const sequentialPart = String(newNum).padStart(4, '0');

    return `${prefix}.${sequentialPart}`;
};

/**
 * @description Menyimpan data DP baru.
 */
const saveNewDp = async (dpData, user) => {
    const { customerKode, tanggal, jenis, nominal, keterangan, bankData } = dpData;
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
        const cabang = user.cabang;
        // getmaxdp logic
        const prefix = `${cabang}.STR.${format(new Date(tanggal), 'yyMM')}`;
        const [maxRows] = await connection.query(`SELECT IFNULL(MAX(RIGHT(sh_nomor, 4)), 0) as maxNum FROM tsetor_hdr WHERE LEFT(sh_nomor, 12) = ?`, [prefix]);
        const nextNum = parseInt(maxRows[0].maxNum, 10) + 1;
        const dpNomor = `${prefix}.${String(10000 + nextNum).slice(1)}`;

        let query, params;
        const jenisNum = jenis === 'TUNAI' ? 0 : (jenis === 'TRANSFER' ? 1 : 2);

        if (jenis === 'TUNAI') {
            query = `INSERT INTO tsetor_hdr (sh_nomor, sh_cus_kode, sh_tanggal, sh_jenis, sh_nominal, sh_ket, user_create, date_create) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`;
            params = [dpNomor, customerKode, tanggal, jenisNum, nominal, keterangan, user.kode];
        } else if (jenis === 'TRANSFER') {
            query = `INSERT INTO tsetor_hdr (sh_nomor, sh_cus_kode, sh_tanggal, sh_jenis, sh_nominal, sh_akun, sh_norek, sh_tgltransfer, sh_ket, user_create, date_create) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
            params = [dpNomor, customerKode, tanggal, jenisNum, nominal, bankData.akun, bankData.norek, bankData.tglTransfer, keterangan, user.kode];
        } else if (jenis === 'GIRO') {
            query = `INSERT INTO tsetor_hdr (sh_nomor, sh_cus_kode, sh_tanggal, sh_jenis, sh_nominal, sh_giro, sh_tglgiro, sh_tempogiro, sh_ket, user_create, date_create) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
            params = [dpNomor, customerKode, tanggal, jenisNum, nominal, giroData.noGiro, giroData.tglGiro, giroData.tglJatuhTempo, keterangan, user.kode];
        }

        await connection.query(query, params);
        await connection.commit();

        return { success: true, message: `Setoran DP ${dpNomor} berhasil disimpan.`, newDp: { nomor: dpNomor, jenis, nominal, posting: 'BELUM' } };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

/**
 * @description Mencari rekening bank yang tersedia untuk cabang tertentu.
 */
const searchRekening = async (filters) => {
    const { cabang, term } = filters;
    const searchTerm = `%${term || ''}%`;
    const query = `
        SELECT 
            rek_kode AS kode,
            rek_nama AS nama,
            rek_rekening AS rekening
        FROM finance.trekening 
        WHERE rek_kaosan LIKE ? 
          AND (rek_kode LIKE ? OR rek_nama LIKE ?)
    `;
    const [rows] = await pool.query(query, [`%${cabang}%`, searchTerm, searchTerm]);
    return rows;
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
        // Bisa ditambahkan Miliar, Triliun, dst.
        return "angka terlalu besar";
    };

    return terbilangRecursive(n).replace(/\s+/g, ' ').trim();
}

/**
 * Helper untuk membuat huruf pertama menjadi kapital.
 * Contoh: "dua belas ribu" -> "Dua belas ribu"
 */
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '');

/**
 * @description Mengambil semua data yang diperlukan untuk mencetak Cash Receipt (DP).
 */
const getDataForDpPrint = async (nomorSetoran) => {
    // Query ini telah dibuat lebih aman dengan IFNULL
    const query = `
        SELECT 
            h.sh_nomor, h.sh_tanggal, h.sh_nominal, h.sh_ket,
            IF(h.sh_jenis=0, 'TUNAI', IF(h.sh_jenis=1, 'TRANSFER', 'GIRO')) AS jenis_pembayaran,
            c.cus_nama, c.cus_alamat, c.cus_telp,
            h.sh_so_nomor,
            IFNULL(r.rek_nama, '') AS nama_akun, 
            IFNULL(r.rek_rekening, '') AS no_rekening,
            DATE_FORMAT(h.sh_tgltransfer, "%d-%m-%Y") AS tgl_transfer,
            h.user_create
        FROM tsetor_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.sh_cus_kode
        LEFT JOIN finance.trekening r ON r.rek_kode = h.sh_akun
        WHERE h.sh_nomor = ?
    `;
    const [rows] = await pool.query(query, [nomorSetoran]);
    if (rows.length === 0) return null;

    const data = rows[0];

    // Tambahkan pengecekan keamanan sebelum memanggil terbilang
    const nominal = parseFloat(data.sh_nominal);
    if (!isNaN(nominal)) {
        data.terbilang = capitalize(terbilang(nominal)) + " Rupiah";
    } else {
        data.terbilang = "Nominal tidak valid";
    }

    return data;
};

module.exports = {
    save,
    getSoForEdit,
    getPenawaranDetailsForSo,
    searchAvailablePenawaran,
    getDefaultDiscount,
    searchAvailableSetoran,
    generateNewDpNumber,
    saveNewDp,
    searchRekening,
    getDataForDpPrint,
    // ...
};
