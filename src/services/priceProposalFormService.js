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
// di file: src/services/priceProposalFormService.js

const getTshirtTypeDetails = async (jenisKaos, custom) => {
    // 1. Siapkan kedua query
    const sizeQuery = `
        SELECT 
            u.ukuran,
            CASE
                WHEN u.ukuran = "S" THEN k.jk_s WHEN u.ukuran = "M" THEN k.jk_m
                WHEN u.ukuran = "L" THEN k.jk_l WHEN u.ukuran = "XL" THEN k.jk_xl
                WHEN u.ukuran = "2XL" THEN k.jk_2xl WHEN u.ukuran = "3XL" THEN k.jk_3xl
                WHEN u.ukuran = "4XL" THEN k.jk_4xl WHEN u.ukuran = "5XL" THEN k.jk_5xl
                ELSE 0
            END AS hargaPcs
        FROM tukuran u
        JOIN tjeniskaos k ON k.jk_Jenis = ? AND k.jk_custom = ?
        WHERE u.kategori = "" AND u.kode >= 2 AND u.kode <= 16
        ORDER BY u.kode;
    `;
    const costsQuery = `
        SELECT bt_tambahan, bt_cm, bt_min 
        FROM tbiayatambahan 
        WHERE bt_tambahan IN ('BORDIR', 'DTF')
    `;

    try {
        // 2. Jalankan kedua query secara paralel untuk efisiensi
        const [
            [sizeRows],
            [costRows]
        ] = await Promise.all([
            pool.query(sizeQuery, [jenisKaos, custom]),
            pool.query(costsQuery)
        ]);

        // 3. Gabungkan hasilnya (logika ini tetap sama)
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
            costs: costs
        };
    } catch (error) {
        // Tambahkan log yang lebih detail di sini untuk debugging di masa depan
        console.error(`[ERROR] Gagal getTshirtTypeDetails untuk jenisKaos: "${jenisKaos}", custom: "${custom}"`);
        console.error(error); // Cetak error SQL yang sebenarnya ke konsol backend
        throw error; // Lemparkan kembali error agar controller bisa menangkapnya
    }
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

const getProposalForEdit = async (nomor) => {
    // 1. Ambil data Header
    const [headerRows] = await pool.query(`
  SELECT h.*, c.cus_nama
  FROM tpengajuanharga h
  LEFT JOIN tcustomer c ON c.cus_kode = h.ph_kd_cus
  WHERE ph_nomor = ?
`, [nomor]);
    if (headerRows.length === 0) {
        throw new Error(`Pengajuan harga dengan nomor ${nomor} tidak ditemukan.`);
    }
    const headerData = headerRows[0];

    // 2. Ambil data Detail Ukuran
    const [sizeData] = await pool.query(`
  SELECT d.*, 
   CONCAT(a.brg_jeniskaos, ' ', a.brg_tipe, ' ', a.brg_lengan, ' ',
          a.brg_jeniskain, ' ', a.brg_warna) AS namaBarang
FROM tpengajuanharga_size d
LEFT JOIN tbarangdc a ON a.brg_kode = d.phs_kode
WHERE d.phs_nomor = ?
`, [nomor]);

    // 3. Ambil data Biaya Tambahan
    const [additionalCosts] = await pool.query('SELECT * FROM tpengajuanharga_tambahan WHERE pht_nomor = ?', [nomor]);

    // 4. Ambil data Bordir
    const [bordirDataRows] = await pool.query('SELECT * FROM tpengajuanharga_bordir WHERE phb_nomor = ?', [nomor]);
    const bordirData = bordirDataRows.length > 0 ? bordirDataRows[0] : null;

    // 5. Ambil data DTF
    const [dtfDataRows] = await pool.query('SELECT * FROM tpengajuanharga_dtf WHERE phd_nomor = ?', [nomor]);
    const dtfData = dtfDataRows.length > 0 ? dtfDataRows[0] : null;

    // 6. Cek & kirim URL gambar jika ada
    const cabang = nomor.substring(0, 3);
    const imagePath = path.join(process.cwd(), 'public', 'images', cabang, `${nomor}.jpg`);
    headerData.imageUrl = fs.existsSync(imagePath) ? `/images/${cabang}/${nomor}.jpg` : null;

    return { headerData, sizeData, additionalCosts, bordirData, dtfData };
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

const saveProposal = async (data) => {
    const { header, details, bordirItems = [], dtfItems = [], additionalCostItems = [],
        user, isNew, biayaPerCmBordir, bordirMinCharge, bordirCost,
        biayaPerCmDtf, dtfMinCharge, dtfCost } = data;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction(); // <-- MULAI TRANSAKSI

        let nomor = header.nomor;
        if (isNew) {
            // Asumsi fungsi generateNewProposalNumber sudah ada di service ini
            nomor = await generateNewProposalNumber(user.cabang, header.tanggal);
        }

        // 1. Simpan/Update Header (tpengajuanharga)
        if (isNew) {
            const headerQuery = `
                INSERT INTO tpengajuanharga 
                    (ph_nomor, ph_tanggal, ph_custom, ph_kd_cus, ph_ket, ph_jenis, ph_apv, ph_diskon, user_create, date_create) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `;
            await connection.query(headerQuery, [
                nomor, header.tanggal, header.ketersediaan === 'Custom' ? 'Y' : 'N',
                header.customerKode, header.keterangan, header.jenisKaos,
                header.approval, data.footer.diskon, user.kode
            ]);
        } else {
            const headerQuery = `
                UPDATE tpengajuanharga SET 
                    ph_tanggal = ?, ph_custom = ?, ph_kd_cus = ?, ph_ket = ?, ph_jenis = ?, ph_apv = ?, ph_diskon = ?, user_modified = ?, date_modified = NOW() 
                WHERE ph_nomor = ?
            `;
            await connection.query(headerQuery, [
                header.tanggal, header.ketersediaan === 'Custom' ? 'Y' : 'N',
                header.customerKode, header.keterangan, header.jenisKaos,
                header.approval, data.footer.diskon, user.kode, nomor
            ]);
        }

        // 4. Hapus bordir lama & Simpan bordir baru HANYA JIKA ADA DATA
        await connection.query(`DELETE FROM tpengajuanharga_bordir WHERE phb_nomor = ?`, [nomor]);
        // Cek jika ada item bordir yang diisi (p atau l > 0)
        const hasBordirData = bordirItems.some(item => (item.p || 0) > 0 || (item.l || 0) > 0);
        if (hasBordirData) {
            const bordirQuery = `
                INSERT INTO tpengajuanharga_bordir (phb_nomor, phb_cmbordir, phb_minbordir, phb_rpbordir, phb_bordirp1, phb_bordirl1, phb_bordirp2, phb_bordirl2, phb_bordirp3, phb_bordirl3, phb_bordirp4, phb_bordirl4, phb_bordirp5, phb_bordirl5, phb_bordirp6, phb_bordirl6, phb_bordirp7, phb_bordirl7, phb_bordirp8, phb_bordirl8)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            await connection.query(bordirQuery, [
                nomor, biayaPerCmBordir || 0, bordirMinCharge || 0, bordirCost || 0,
                bordirItems[0]?.p || 0, bordirItems[0]?.l || 0, bordirItems[1]?.p || 0, bordirItems[1]?.l || 0,
                bordirItems[2]?.p || 0, bordirItems[2]?.l || 0, bordirItems[3]?.p || 0, bordirItems[3]?.l || 0,
                bordirItems[4]?.p || 0, bordirItems[4]?.l || 0, bordirItems[5]?.p || 0, bordirItems[5]?.l || 0,
                bordirItems[6]?.p || 0, bordirItems[6]?.l || 0, bordirItems[7]?.p || 0, bordirItems[7]?.l || 0
            ]);
        }

        // 5. Hapus DTF lama & Simpan DTF baru HANYA JIKA ADA DATA
        await connection.query(`DELETE FROM tpengajuanharga_dtf WHERE phd_nomor = ?`, [nomor]);
        // Cek jika ada item DTF yang diisi (p atau l > 0)
        const hasDtfData = dtfItems.some(item => (item.p || 0) > 0 || (item.l || 0) > 0);
        if (hasDtfData) {
            const dtfQuery = `
                INSERT INTO tpengajuanharga_dtf (phd_nomor, phd_cmdtf, phd_mindtf, phd_rpdtf, phd_dtfp1, phd_dtfl1, phd_dtfp2, phd_dtfl2, phd_dtfp3, phd_dtfl3, phd_dtfp4, phd_dtfl4, phd_dtfp5, phd_dtfl5, phd_dtfp6, phd_dtfl6, phd_dtfp7, phd_dtfl7, phd_dtfp8, phd_dtfl8)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            await connection.query(dtfQuery, [
                nomor, biayaPerCmDtf || 0, dtfMinCharge || 0, dtfCost || 0,
                dtfItems[0]?.p || 0, dtfItems[0]?.l || 0, dtfItems[1]?.p || 0, dtfItems[1]?.l || 0,
                dtfItems[2]?.p || 0, dtfItems[2]?.l || 0, dtfItems[3]?.p || 0, dtfItems[3]?.l || 0,
                dtfItems[4]?.p || 0, dtfItems[4]?.l || 0, dtfItems[5]?.p || 0, dtfItems[5]?.l || 0,
                dtfItems[6]?.p || 0, dtfItems[6]?.l || 0, dtfItems[7]?.p || 0, dtfItems[7]?.l || 0
            ]);
        }

        await connection.commit(); // <-- SUKSES, SIMPAN SEMUA PERUBAHAN
        return { message: `Pengajuan harga ${nomor} berhasil disimpan.` };

    } catch (error) {
        await connection.rollback(); // <-- GAGAL, BATALKAN SEMUA PERUBAHAN
        console.error("Save Proposal Error:", error);
        throw new Error('Gagal menyimpan data ke database.');
    } finally {
        connection.release(); // Selalu lepaskan koneksi
    }
};


module.exports = {
    generateNewProposalNumber,
    searchTshirtTypes,
    getTshirtTypeDetails,
    getDiscountByBruto,
    searchProductsByType,
    searchAdditionalCosts,
    getProposalForEdit,
    renameProposalImage,
    saveProposal,
};
