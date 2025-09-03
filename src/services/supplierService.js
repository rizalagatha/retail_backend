const pool = require('../config/database');

const getAllSuppliers = async () => {
    const query = `
        SELECT 
            sup_kode AS kode,
            sup_nama AS nama,
            sup_alamat AS alamat,
            sup_kota AS kota,
            sup_telp AS telp,
            sup_cp AS contactPerson,
            IF(sup_aktif = 'Y', 'AKTIF', 'PASIF') AS status
        FROM tsupplier 
        ORDER BY sup_nama;
    `;
    const [rows] = await pool.query(query);
    return rows;
};

const saveSupplier = async (supplierData) => {
    const { isNew, kode, nama, alamat, kota, telp, contactPerson, status } = supplierData;
    const supAktif = status === 'AKTIF' ? 'Y' : 'N';

    if (isNew) {
        // Anda perlu membuat fungsi generate kode baru di sini jika diperlukan
        await pool.query(
            'INSERT INTO tsupplier (sup_kode, sup_nama, sup_alamat, sup_kota, sup_telp, sup_cp, sup_aktif) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [kode, nama, alamat, kota, telp, contactPerson, supAktif]
        );
    } else {
        await pool.query(
            'UPDATE tsupplier SET sup_nama = ?, sup_alamat = ?, sup_kota = ?, sup_telp = ?, sup_cp = ?, sup_aktif = ? WHERE sup_kode = ?',
            [nama, alamat, kota, telp, contactPerson, supAktif, kode]
        );
    }
    return { success: true, message: 'Data supplier berhasil disimpan.' };
};

const deleteSupplier = async (kode) => {
    await pool.query('DELETE FROM tsupplier WHERE sup_kode = ?', [kode]);
    return { success: true, message: 'Data supplier berhasil dihapus.' };
};

module.exports = {
    getAllSuppliers,
    saveSupplier,
    deleteSupplier,
};