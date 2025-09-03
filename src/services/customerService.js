// backend/src/services/customerService.js
const pool = require('../config/database');

const getAllCustomers = async () => {
    const query = `
        SELECT 
            c.cus_kode AS kode,
            c.cus_nama AS nama,
            c.cus_alamat AS alamat,
            c.cus_kota AS kota,
            c.cus_telp AS telp,
            c.cus_nama_kontak AS namaKontak,
            IF(c.cus_aktif = 0, 'AKTIF', 'PASIF') AS status
        FROM tcustomer c
        ORDER BY c.cus_kode;
    `;
    const [rows] = await pool.query(query);
    return rows;
};

const saveCustomer = async (customerData) => {
    const { 
        isNew, kode, nama, alamat, kota, telp, namaKontak, 
        tglLahir, top, status, level, npwp, namaNpwp, alamatNpwp, kotaNpwp 
    } = customerData;
    
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const cusAktif = status === 'AKTIF' ? 0 : 1;
        let newKode = kode;

        if (isNew) {
            // Ganti 'K03' dengan cabang user yang sedang login
            const userCabang = 'K03'; 
            newKode = await generateNewCustomerCode(userCabang);

            await connection.query(
                `INSERT INTO tcustomer (cus_kode, cus_nama, cus_alamat, cus_kota, cus_telp, cus_nama_kontak, cus_tgllahir, cus_top, cus_aktif, cus_npwp, cus_nama_npwp, cus_alamat_npwp, cus_kota_npwp) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [newKode, nama, alamat, kota, telp, namaKontak, tglLahir, top, cusAktif, npwp, namaNpwp, alamatNpwp, kotaNpwp]
            );
        } else {
            await connection.query(
                `UPDATE tcustomer SET cus_nama = ?, cus_alamat = ?, cus_kota = ?, cus_telp = ?, cus_nama_kontak = ?, cus_tgllahir = ?, cus_top = ?, cus_aktif = ?, cus_npwp = ?, cus_nama_npwp = ?, cus_alamat_npwp = ?, cus_kota_npwp = ?
                 WHERE cus_kode = ?`,
                [nama, alamat, kota, telp, namaKontak, tglLahir, top, cusAktif, npwp, namaNpwp, alamatNpwp, kotaNpwp, newKode]
            );
        }

        // Logika untuk update history level
        if (level) {
             await connection.query(
                `INSERT INTO tcustomer_level_history (clh_cus_kode, clh_tanggal, clh_level) 
                 VALUES (?, CURDATE(), ?)
                 ON DUPLICATE KEY UPDATE clh_level = ?`,
                [newKode, level, level]
            );
        }

        await connection.commit();
        return { success: true, message: `Data customer berhasil disimpan dengan kode ${newKode}.` };
    } catch (error) {
        await connection.rollback();
        console.error("Error saving customer:", error);
        throw new Error('Gagal menyimpan data customer.');
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
    saveCustomer,
    deleteCustomer,
    getCustomerDetails,
    generateNewCustomerCode,
    getCustomerLevels,
};