const pool = require('../config/database');

const getAllMembers = async () => {
    const query = `
        SELECT 
            mem_hp AS hp,
            mem_nama AS nama,
            mem_alamat AS alamat,
            mem_gender AS gender,
            mem_usia AS usia,
            mem_referensi AS referensi
        FROM tmember 
        ORDER BY mem_nama;
    `;
    const [rows] = await pool.query(query);
    return rows;
};

const saveMember = async (memberData) => {
    const { isNew, hp, nama, alamat, gender, usia, referensi } = memberData;
    
    if (isNew) {
        await pool.query(
            'INSERT INTO tmember (mem_hp, mem_nama, mem_alamat, mem_gender, mem_usia, mem_referensi) VALUES (?, ?, ?, ?, ?, ?)',
            [hp, nama, alamat, gender, usia, referensi]
        );
    } else {
        await pool.query(
            'UPDATE tmember SET mem_nama = ?, mem_alamat = ?, mem_gender = ?, mem_usia = ?, mem_referensi = ? WHERE mem_hp = ?',
            [nama, alamat, gender, usia, referensi, hp]
        );
    }
    return { success: true, message: 'Data member berhasil disimpan.' };
};

const deleteMember = async (hp) => {
    await pool.query('DELETE FROM tmember WHERE mem_hp = ?', [hp]);
    return { success: true, message: 'Data member berhasil dihapus.' };
};

module.exports = {
    getAllMembers,
    saveMember,
    deleteMember,
};