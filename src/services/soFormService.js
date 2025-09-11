const pool = require('../config/database');
const { format } = require('date-fns');

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
        if (isNew) {
            soNomor = await generateNewSoNumber(connection, header.gudang.kode, header.tanggal);
        }
        
        // ... (Logika INSERT/UPDATE header Anda di sini) ...
        // ... (Logika DELETE/INSERT detail Anda di sini) ...

        // --- 👇 TAMBAHKAN BLOK INI UNTUK SIMPAN PIN 👇 ---
        // Meniru logika 'simpanpin' dari Delphi
        for (const item of details) {
            if (item.pin) { // Simpan PIN per item
                await connection.query('INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_barcode, o_created, o_pin, o_nominal) VALUES (?, "SO", "DISKON ITEM", ?, NOW(), ?, ?)', [soNomor, item.barcode || '', item.pin, item.diskonPersen]);
            }
        }
        if (footer.pinDiskon1) { // Simpan PIN Diskon Faktur 1
            await connection.query('INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_created, o_pin, o_nominal) VALUES (?, "SO", "DISKON FAKTUR", NOW(), ?, ?)', [soNomor, footer.pinDiskon1, footer.diskonPersen1]);
        }
        if (footer.pinDiskon2) { // Simpan PIN Diskon Faktur 2
            await connection.query('INSERT INTO totorisasi (o_nomor, o_transaksi, o_jenis, o_created, o_pin, o_nominal) VALUES (?, "SO", "DISKON FAKTUR 2", NOW(), ?, ?)', [soNomor, footer.pinDiskon2, footer.diskonPersen2]);
        }
        // TODO: Tambahkan logika untuk PIN DP jika diperlukan
        // --- 👆 AKHIR BLOK SIMPAN PIN 👆 ---

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
    // ... (Query kompleks untuk JOIN tso_hdr, tso_dtl, tcustomer, tsetor_hdr, dll.)
    // Akan mengembalikan objek { header, details, dps }
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

module.exports = {
    save,
    getSoForEdit,
    getPenawaranDetailsForSo,
    searchAvailablePenawaran,
    getDefaultDiscount,
    // ...
};
