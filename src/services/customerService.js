// backend/src/services/customerService.js
const pool = require('../config/database');

// Di file: src/services/customerService.js

const getAllCustomers = async () => {
    const query = `
        SELECT 
            c.cus_kode AS kode,
            c.cus_nama AS nama,
            c.cus_alamat AS alamat,
            c.cus_kota AS kota,
            c.cus_telp AS telp,
            c.cus_nama_kontak AS namaKontak,
            IF(c.cus_aktif = 0, 'AKTIF', 'PASIF') AS status,
            c.cus_tgllahir AS tglLahir,
            c.cus_top AS top,
            (
                SELECT lvl.level_nama
                FROM tcustomer_level_history h
                LEFT JOIN tcustomer_level lvl ON h.clh_level = lvl.level_kode
                WHERE h.clh_cus_kode = c.cus_kode
                ORDER BY h.clh_tanggal DESC -- Mengurutkan hanya berdasarkan tanggal
                LIMIT 1
            ) AS level
        FROM tcustomer c
        ORDER BY c.cus_kode;
    `;
    const [rows] = await pool.query(query);
    return rows;
};

/**
 * @description Membuat customer baru (INSERT).
 */
const createCustomer = async (customerData, user) => {
    const { nama, alamat, kota, telp, namaKontak, tglLahir, top, status, level, npwp, namaNpwp, alamatNpwp, kotaNpwp } = customerData;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const cusAktif = status === 'AKTIF' ? 0 : 1;
        
        // Buat kode baru
        const userCabang = user.cabang || 'K03'; // Ambil cabang dari user yang login
        const newKode = await generateNewCustomerCode(userCabang);

        let formattedTglLahir = tglLahir ? new Date(tglLahir).toISOString().split('T')[0] : null;

        await connection.query(
            `INSERT INTO tcustomer (cus_kode, cus_nama, cus_alamat, cus_kota, cus_telp, cus_nama_kontak, cus_tgllahir, cus_top, cus_aktif, cus_npwp, cus_nama_npwp, cus_alamat_npwp, cus_kota_npwp) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [newKode, nama, alamat, kota, telp, namaKontak, formattedTglLahir, top, cusAktif, npwp, namaNpwp, alamatNpwp, kotaNpwp]
        );
        
        if (level) {
            await connection.query(
               `INSERT INTO tcustomer_level_history (clh_cus_kode, clh_tanggal, clh_level) VALUES (?, CURDATE(), ?)`,
               [newKode, level]
            );
        }

        const [newCustomerRows] = await connection.query(`
            SELECT 
                c.cus_kode AS kode, c.cus_nama AS nama, c.cus_alamat AS alamat, c.cus_kota AS kota, c.cus_telp AS telp, c.cus_top as top,
                IFNULL(CONCAT(x.clh_level, " - " ,x.level_nama), "") AS level
            FROM tcustomer c
            LEFT JOIN (
                SELECT i.clh_cus_kode, i.clh_level, l.level_nama FROM tcustomer_level_history i 
                LEFT JOIN tcustomer_level l ON l.level_kode = i.clh_level
                WHERE i.clh_cus_kode = ? ORDER BY i.clh_tanggal DESC LIMIT 1
            ) x ON x.clh_cus_kode = c.cus_kode
            WHERE c.cus_kode = ?
        `, [newKode, newKode]);
        
        await connection.commit();

        return { 
            success: true, 
            message: `Customer baru berhasil disimpan dengan kode ${newKode}.`,
            newCustomer: newCustomerRows[0] 
        };
    } catch (error) {
        await connection.rollback();
        console.error("Error creating customer:", error);
        throw new Error('Gagal menyimpan customer baru.');
    } finally {
        connection.release();
    }
};

/**
 * @description Memperbarui customer yang ada (UPDATE).
 */
const updateCustomer = async (kode, customerData) => {
    const { nama, alamat, kota, telp, namaKontak, tglLahir, top, status, level, npwp, namaNpwp, alamatNpwp, kotaNpwp } = customerData;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const cusAktif = status === 'AKTIF' ? 0 : 1;
        let formattedTglLahir = tglLahir ? new Date(tglLahir).toISOString().split('T')[0] : null;

        await connection.query(
            `UPDATE tcustomer SET cus_nama = ?, cus_alamat = ?, cus_kota = ?, cus_telp = ?, cus_nama_kontak = ?, cus_tgllahir = ?, cus_top = ?, cus_aktif = ?, cus_npwp = ?, cus_nama_npwp = ?, cus_alamat_npwp = ?, cus_kota_npwp = ?
             WHERE cus_kode = ?`,
            [nama, alamat, kota, telp, namaKontak, formattedTglLahir, top, cusAktif, npwp, namaNpwp, alamatNpwp, kotaNpwp, kode]
        );
        
        if (level) {
             await connection.query(
                `INSERT INTO tcustomer_level_history (clh_cus_kode, clh_tanggal, clh_level) 
                 VALUES (?, CURDATE(), ?)
                 ON DUPLICATE KEY UPDATE clh_level = ?`,
                [kode, level, level]
             );
        }

        await connection.commit();
        return { success: true, message: `Data customer ${kode} berhasil diperbarui.` };
    } catch (error) {
        await connection.rollback();
        console.error("Error updating customer:", error);
        throw new Error('Gagal memperbarui data customer.');
    } finally {
        connection.release();
    }
};

const deleteCustomer = async (kode) => {
    await pool.query('DELETE FROM tcustomer WHERE cus_kode = ?', [kode]);
    return { success: true, message: 'Data customer berhasil dihapus.' };
};

const getCustomerDetails = async (kode) => {
    // Perbarui query SELECT untuk membuat alias pada setiap kolom
    const query = `
        SELECT 
            cus_kode AS kode,
            cus_nama AS nama,
            cus_alamat AS alamat,
            cus_kota AS kota,
            cus_telp AS telp,
            cus_nama_kontak AS namaKontak,
            cus_tgllahir AS tglLahir,
            cus_top AS top,
            IF(cus_aktif = 0, 'AKTIF', 'PASIF') AS status,
            cus_npwp AS npwp,
            cus_nama_npwp AS namaNpwp,
            cus_alamat_npwp AS alamatNpwp,
            cus_kota_npwp AS kotaNpwp
        FROM tcustomer 
        WHERE cus_kode = ?
    `;
    const [customerRows] = await pool.query(query, [kode]);
    if (customerRows.length === 0) return null;

    const [levelHistoryRows] = await pool.query(`
        SELECT h.clh_tanggal as tanggal, h.clh_level as kode, l.level_nama as level
        FROM tcustomer_level_history h
        LEFT JOIN tcustomer_level l ON l.level_kode = h.clh_level
        WHERE h.clh_cus_kode = ? ORDER BY h.clh_tanggal DESC
    `, [kode]);

    const [levels] = await pool.query('SELECT level_kode as kode, level_nama as nama FROM tcustomer_level WHERE level_aktif="Y"');

    return { customer: customerRows[0], levelHistory: levelHistoryRows, levels };
};

const generateNewCustomerCode = async (cabang) => {
    // Logika ini meniru fungsi getnomor dari Delphi
    const [rows] = await pool.query(
        'SELECT IFNULL(MAX(RIGHT(cus_kode, 5)), 0) as lastNum FROM tcustomer WHERE LEFT(cus_kode, 3) = ?',
        [cabang]
    );
    const lastNum = parseInt(rows[0].lastNum, 10);
    const newNum = (100001 + lastNum).toString().slice(1);
    return `${cabang}${newNum}`;
};

const getCustomerLevels = async () => {
    const [rows] = await pool.query(
        'SELECT level_kode as kode, level_nama as nama FROM tcustomer_level WHERE level_aktif="Y" ORDER BY level_kode'
    );
    return rows;
};

module.exports = {
    getAllCustomers,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    getCustomerDetails,
    generateNewCustomerCode,
    getCustomerLevels,
};