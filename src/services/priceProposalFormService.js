const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { format } = require('date-fns');

/**
 * Membuat nomor pengajuan harga baru, meniru getnomor dari Delphi.
 * Format: [Cabang].[Tahun].[Nomor Urut 5 digit] -> K02.2024.00001
 */
const generateNewProposalNumber = async (cabang, tanggal) => {
    const year = format(new Date(tanggal), 'yyyy');
    const prefix = `${cabang}.${year}`;
    const query = `
        SELECT IFNULL(MAX(RIGHT(ph_nomor, 5)), 0) as lastNum 
        FROM tpengajuanharga 
        WHERE LEFT(ph_nomor, 8) = ?
    `;
    const [rows] = await pool.query(query, [prefix]);
    const lastNum = parseInt(rows[0].lastNum, 10);
    const newNum = (lastNum + 1).toString().padStart(5, '0');
    return `${prefix}.${newNum}`;
};

/**
 * Mencari jenis kaos untuk F1 help.
 */
const searchTshirtTypes = async (term, custom) => {
    let query = 'SELECT DISTINCT jk_Jenis AS jenisKaos FROM tjeniskaos';
    const params = [];

    if (custom === 'Y') {
        query += ' WHERE jk_custom = "Y"';
    } else {
        query += ' WHERE jk_custom = "N"';
    }

    if (term) {
        query += ' AND jk_Jenis LIKE ?';
        params.push(`%${term}%`);
    }
    query += ' ORDER BY jk_Jenis';
    const [rows] = await pool.query(query, params);
    return rows;
};

/**
 * Mengambil daftar ukuran dan harga dasar berdasarkan jenis kaos.
 * Mereplikasi logika dari loadjeniskaos di Delphi.
 */
const getTshirtTypeDetails = async (jenisKaos, custom) => {
    const query = `
        SELECT 
            u.ukuran,
            CASE
                WHEN u.ukuran = "S" THEN k.jk_s
                WHEN u.ukuran = "M" THEN k.jk_m
                WHEN u.ukuran = "L" THEN k.jk_l
                WHEN u.ukuran = "XL" THEN k.jk_xl
                WHEN u.ukuran = "2XL" THEN k.jk_2xl
                WHEN u.ukuran = "3XL" THEN k.jk_3xl
                WHEN u.ukuran = "4XL" THEN k.jk_4xl
                WHEN u.ukuran = "5XL" THEN k.jk_5xl
                ELSE 0
            END AS hargaPcs
        FROM tukuran u
        JOIN tjeniskaos k ON k.jk_Jenis = ? AND k.jk_custom = ?
        WHERE u.kategori = "" AND u.kode >= 2 AND u.kode <= 16
        ORDER BY u.kode;
    `;
    const [sizeRows] = await pool.query(sizeQuery, [jenisKaos, custom]);
    // 2. Query BARU untuk mengambil data biaya Bordir & DTF
    const costsQuery = `
        SELECT bt_tambahan, bt_cm, bt_min 
        FROM tbiayatambahan 
        WHERE bt_tambahan IN ('BORDIR', 'DTF')
    `;
    const [costRows] = await pool.query(costsQuery);

    // 3. Gabungkan hasilnya ke dalam satu objek
    const costs = {};
    costRows.forEach(row => {
        if (row.bt_tambahan === 'BORDIR') {
            costs.bordir = { cm: row.bt_cm, min: row.bt_min };
        } else if (row.bt_tambahan === 'DTF') {
            costs.dtf = { cm: row.bt_cm, min: row.bt_min };
        }
    });

    return {
        sizes: sizeRows,
        costs: costs // Kembalikan data biaya bersamaan dengan data ukuran
    };
};

const getDiscountByBruto = async (bruto) => {
    if (!bruto || isNaN(parseFloat(bruto))) {
        // Jika bruto tidak valid atau 0, kembalikan diskon 0
        return 0;
    }

    const query = `
        SELECT diskon 
        FROM tpengajuanharga_diskon 
        WHERE ? >= harga1 AND ? <= harga2
    `;
    const [rows] = await pool.query(query, [bruto, bruto]);

    let diskonRp = 0;
    if (rows.length > 0) {
        const diskonPersen = rows[0].diskon;
        diskonRp = (diskonPersen / 100) * parseFloat(bruto);
    }

    return diskonRp;
};

const searchProductsByType = async (jenisKaos) => {
    // Query ini meniru CONCAT dan LIKE dari kode Delphi Anda
    const query = `
        SELECT 
            x.Kode,
            x.Nama
        FROM (
            SELECT 
                a.brg_kode AS Kode,
                TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna)) AS Nama
            FROM tbarangdc a
            WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
        ) x
        WHERE x.Nama LIKE ?
        ORDER BY x.Nama;
    `;
    const [rows] = await pool.query(query, [`${jenisKaos}%`]);
    return rows;
};

const searchAdditionalCosts = async () => {
    // Query ini meniru SQLbantuan dari kode Delphi Anda
    const query = `
        SELECT 
            bt_tambahan AS tambahan,
            bt_harga AS harga 
        FROM tbiayatambahan 
        WHERE bt_harga <> 0 
        ORDER BY bt_tambahan
    `;
    const [rows] = await pool.query(query);
    return rows;
};

const getFullProposalDetails = async (nomor) => {
    // 1. Ambil data header
    const headerQuery = `
        SELECT h.*, c.cus_nama 
        FROM tpengajuanharga h 
        LEFT JOIN tcustomer c ON c.cus_kode = h.ph_kd_cus 
        WHERE h.ph_nomor = ?
    `;
    const [headerRows] = await pool.query(headerQuery, [nomor]);
    if (headerRows.length === 0) {
        throw new Error('Data pengajuan tidak ditemukan.');
    }

    const cabang = nomor.substring(0, 3);

    // `process.cwd()` adalah cara yang lebih andal untuk mendapatkan root direktori proyek Anda
    const imagePath = path.join(process.cwd(), 'public', 'images', cabang, `${nomor}.jpg`);
    let imageUrl = null;

    if (fs.existsSync(imagePath)) {
        // Bangun URL yang benar, sertakan subfolder cabang
        imageUrl = `${process.env.BASE_URL || 'http://192.168.1.73:8000'}/images/${cabang}/${nomor}.jpg`;
    }

    // 2. Ambil data detail ukuran/size
    const sizeQuery = `SELECT * FROM tpengajuanharga_size WHERE phs_nomor = ?`;
    const [sizeRows] = await pool.query(sizeQuery, [nomor]);

    // 3. Ambil data bordir
    const bordirQuery = `SELECT * FROM tpengajuanharga_bordir WHERE phb_nomor = ?`;
    const [bordirRows] = await pool.query(bordirQuery, [nomor]);

    // 4. Ambil data DTF
    const dtfQuery = `SELECT * FROM tpengajuanharga_dtf WHERE phd_nomor = ?`;
    const [dtfRows] = await pool.query(dtfQuery, [nomor]);

    // 5. Ambil data biaya tambahan
    const costQuery = `SELECT * FROM tpengajuanharga_tambahan WHERE pht_nomor = ?`;
    const [costRows] = await pool.query(costQuery, [nomor]);

    return {
        header: headerRows[0],
        sizes: sizeRows,
        bordir: bordirRows[0] || {},
        dtf: dtfRows[0] || {},
        additionalCosts: costRows,
        imageUrl: imageUrl,
    };
};

const renameProposalImage = async (tempFilePath, nomor) => {
    return new Promise((resolve, reject) => {
        // Ambil 3 karakter pertama dari nomor sebagai kode cabang
        const cabang = nomor.substring(0, 3);
        const finalFileName = `${nomor}${path.extname(tempFilePath)}`;

        // Buat path ke folder cabang (misal: .../public/images/K01)
        const branchFolderPath = path.join(process.cwd(), 'public', 'images', cabang);

        // Buat folder cabang jika belum ada
        fs.mkdirSync(branchFolderPath, { recursive: true });

        // Tentukan path tujuan final di dalam folder cabang
        const finalPath = path.join(branchFolderPath, finalFileName);

        fs.rename(tempFilePath, finalPath, (err) => {
            if (err) {
                console.error("Gagal me-rename file:", err);
                return reject(new Error('Gagal memproses file gambar.'));
            }
            resolve(finalPath);
        });
    });
};

module.exports = {
    generateNewProposalNumber,
    searchTshirtTypes,
    getTshirtTypeDetails,
    getDiscountByBruto,
    searchProductsByType,
    searchAdditionalCosts,
    getFullProposalDetails,
    renameProposalImage,
};
