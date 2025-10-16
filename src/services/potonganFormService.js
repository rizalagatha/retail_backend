const pool = require('../config/database');



const { format, addDays, parseISO } = require('date-fns');
const { get } = require('../routes/potonganFormRoute');

/**
 * Menerjemahkan TfrmPotongan.getmaxnomor
 * @param {string} cabang Kode cabang
 * @param {Date} tanggal Tanggal transaksi
 * @returns {Promise<string>} Nomor potongan baru
 */
async function getNextPotonganNumber(cabang, tanggal) {
    const datePart = moment(tanggal).format('YYMM');
    const prefix = `${cabang}.POT.${datePart}`;
    const sql = `SELECT IFNULL(MAX(RIGHT(pt_nomor, 4)), 0) AS max_num FROM tpotongan_hdr WHERE LEFT(pt_nomor, 12)=${quot(prefix)}`;

    const [rows] = await db.query(sql);
    const maxNum = parseInt(rows[0]?.max_num || 0);
    const newSuffix = String(maxNum + 1).padStart(4, '0');

    return `${prefix}.${newSuffix}`;
}

/**
 * Menerjemahkan TfrmPotongan.simpandata
 */

// ...
const getCustomerDetails = async (kode, gudang) => {
    const query = `
        SELECT 
            c.cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp, c.cus_top, c.cus_franchise,
            IFNULL(CONCAT(x.clh_level, " - " ,x.level_nama), "") AS xlevel,
            lvl.level_diskon, lvl.level_diskon2, lvl.level_nominal
        FROM tcustomer c
        // ... JOIN ke tcustomer_level_history dan tcustomer_level
        WHERE c.cus_aktif = 0 AND c.cus_nama NOT LIKE "RETAIL%" AND c.cus_kode = ?;
    `;
    const [rows] = await pool.query(query, [kode, kode]);
    
    // ... Logika validasi bisnis (Level, Franchise KPR vs Non-KPR)

    return { // Mengembalikan objek data customer terstruktur
        kode: customer.cus_kode,
        nama: customer.cus_nama,
        alamat: customer.cus_alamat,
        kota: customer.cus_kota,
        telp: customer.cus_telp,
        top: customer.cus_top,
        level: customer.xlevel,
        discountRule: { /* ... */ }
    };
};

// ...
const searchCustomers = async (term, gudang, page, itemsPerPage) => {
    // ... logika filter, pagination, dan query SQL
    const baseQuery = `
        FROM tcustomer c 
        WHERE c.cus_aktif = 0 AND c.cus_nama NOT LIKE "RETAIL%"
        ${franchiseFilter}
        ${searchFilter}
    `;

    // ... Query COUNT dan Query SELECT data (termasuk join ke tcustomer_level_history)
    // ...
    return { items, total };
};
// ...

async function savePotongan(data, isEdit) {
    let ptNomor = data.pt_nomor;
    const {
        pt_tanggal, pt_cus_kode, pt_akun, pt_nominal,
        details, user_id = GLOBAL.KDUSER, cabang = GLOBAL.CABKAOS
    } = data;
    
    // Konversi nominal (menghilangkan koma)
    const nominalValue = parseFloat(String(pt_nominal).replace(/,/g, '')) || 0;

    await db.beginTransaction();
    try {
        if (!isEdit) {
            // INSERT (Baru)
            ptNomor = await getNextPotonganNumber(cabang, pt_tanggal);
            const insertHeaderSql = `
                INSERT INTO tpotongan_hdr
                (pt_nomor, pt_cus_kode, pt_tanggal, pt_akun, pt_nominal, user_cab, user_create, date_create)
                VALUES (
                ${quot(ptNomor)}, ${quot(pt_cus_kode)}, ${quotd(pt_tanggal)}, ${quot(pt_akun)},
                ${nominalValue}, ${quot(cabang)}, ${quot(user_id)}, NOW());
            `;
            await db.query(insertHeaderSql);
        } else {
            // UPDATE (Ubah)
            const updateHeaderSql = `
                UPDATE tpotongan_hdr SET
                pt_tanggal = ${quotd(pt_tanggal)},
                pt_nominal = ${nominalValue},
                pt_akun = ${quot(pt_akun)},
                user_modified = ${quot(user_id)},
                date_modified = NOW()
                WHERE pt_nomor = ${quot(ptNomor)};
            `;
            await db.query(updateHeaderSql);

            // Hapus detail lama sebelum insert baru
            const deleteDtlSql = `DELETE FROM tpotongan_dtl WHERE ptd_nomor = ${quot(ptNomor)};`;
            await db.query(deleteDtlSql);
        }
        
        // 2. Insert Detail dan Update Piutang
        for (const detail of details) {
            if (detail.invoice && parseFloat(detail.bayar) > 0) {
                // Generate angsuran jika belum ada (meniru logika Delphi)
                const cAngsur = detail.angsur || `${cabang}POT${moment().format('YYYYMMDDHHmmss')}${uuidv4().substring(0, 3)}`;

                // Insert into tpotongan_dtl
                const detailSql = `
                    INSERT INTO tpotongan_dtl 
                    (ptd_nomor, ptd_tanggal, ptd_inv, ptd_bayar, ptd_angsur)
                    VALUES (
                    ${quot(ptNomor)}, ${quotd(detail.tglbayar || pt_tanggal)}, ${quot(detail.invoice)},
                    ${parseFloat(detail.bayar)}, ${quot(cAngsur)});
                `;
                await db.query(detailSql);

                // Insert into tpiutang_dtl (Kredit/Pembayaran Piutang)
                const piutangDtlSql = `
                    INSERT INTO tpiutang_dtl 
                    (pd_ph_nomor, pd_tanggal, pd_uraian, pd_kredit, pd_ket, pd_sd_angsur)
                    VALUES (
                    ${quot(pt_cus_kode + detail.invoice)}, ${quotd(detail.tglbayar || pt_tanggal)}, 'Potongan',
                    ${parseFloat(detail.bayar)}, ${quot(ptNomor)}, ${quot(cAngsur)});
                `;
                await db.query(piutangDtlSql);
            }
        }

        // 3. Logika Sinkronisasi (Menggantikan ShellExecute)
        const syncBranches = ['K02', 'K03', 'K04', 'K05', 'K06', 'K07', 'K08'];
        if (syncBranches.includes(cabang)) {
            // Di sini, harus memanggil layanan sinkronisasi Asinkron (misalnya, melalui RabbitMQ atau proses latar belakang)
            console.log(`[SYNC] Transaksi ${ptNomor} memerlukan sinkronisasi ke cabang.`);
        }

        await db.commit();
        return { success: true, pt_nomor: ptNomor };

    } catch (error) {
        await db.rollback();
        console.error('Potongan Save Error:', error);
        throw new Error('Gagal Simpan Transaksi Potongan. Cek log server.');
    }
}

/**
 * Menerjemahkan TfrmPotongan.loaddataall
 * @param {string} ptNomor Nomor Potongan yang dicari
 * @returns {Promise<Object|null>} Data Potongan lengkap
 */
async function loadPotongan(ptNomor) {
    const sql = `
        SELECT h.*, g.gdg_nama, c.cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp, r.rek_nama, r.rek_rekening,
        IFNULL(d.ptd_inv,"") ptd_inv, d.ptd_tanggal, IFNULL(d.ptd_bayar,0) ptd_bayar, IFNULL(d.ptd_angsur,"") ptd_angsur,
        p.ph_tanggal, IFNULL(p.ph_top,0) ph_top, IFNULL(p.ph_nominal,0) ph_nominal,
        IFNULL(q.mBayar,0) mBayar, IFNULL((p.ph_nominal - IFNULL(q.mBayar,0)),0) sisa
        FROM tpotongan_hdr h
        LEFT JOIN tpotongan_dtl d ON d.ptd_nomor = h.pt_nomor
        LEFT JOIN tgudang g ON g.gdg_kode = LEFT(h.pt_nomor, 3)
        LEFT JOIN tpiutang_hdr p ON p.ph_inv_nomor = d.ptd_inv
        LEFT JOIN (SELECT pd_ph_nomor, SUM(pd_kredit) mBayar FROM tpiutang_dtl GROUP BY pd_ph_nomor) q
            ON q.pd_ph_nomor = p.ph_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = h.pt_cus_kode
        LEFT JOIN finance.trekening r ON r.rek_kode = h.pt_akun
        WHERE h.pt_nomor = ${quot(ptNomor)}
        ORDER BY d.ptd_angsur;
    `;

    const [rows] = await db.query(sql);

    if (rows.length === 0) {
        return null;
    }

    // Memproses hasil query menjadi Header dan Details
    const headerRow = rows[0];
    const header = {
        pt_nomor: headerRow.pt_nomor,
        pt_tanggal: headerRow.pt_tanggal,
        pt_nominal: headerRow.pt_nominal,
        pt_akun: headerRow.pt_akun,
        gdg_kode: headerRow.pt_nomor.substring(0, 3),
        gdg_nama: headerRow.gdg_nama,
        cus_kode: headerRow.pt_cus_kode,
        cus_nama: headerRow.cus_nama,
        cus_alamat: headerRow.cus_alamat,
        cus_kota: headerRow.cus_kota,
        cus_telp: headerRow.cus_telp,
        rek_nama: headerRow.rek_nama,
        rek_rekening: headerRow.rek_rekening,
        details: []
    };

    // Agregasi baris detail (menggantikan perulangan CDS)
    for (const row of rows) {
        if (row.ptd_inv) {
            header.details.push({
                invoice: row.ptd_inv,
                tglbayar: row.ptd_tanggal,
                tanggal: row.ph_tanggal,
                top: row.ph_top,
                jatuhtempo: moment(row.ph_tanggal).add(row.ph_top, 'days').toDate(),
                nominal: row.ph_nominal,
                terbayar: row.mBayar,
                sisa: row.sisa,
                bayar: row.ptd_bayar,
                angsur: row.ptd_angsur,
                lunasi: (row.sisa === row.ptd_bayar) // Logika UI/Client, ditambahkan untuk kelengkapan
            });
        }
    }

    return header;
}

module.exports = {
    savePotongan,
    loadPotongan,
    getNextPotonganNumber,
    searchCustomers,
    getCustomerDetails
};