const pool = require('../config/database');
const jwt = require('jsonwebtoken');

const loginUser = async (kodeUser, password) => {
    // 1. Cari user berdasarkan kode
    const [userRows] = await pool.query(
        'SELECT * FROM tuser WHERE user_kode = ?',
        [kodeUser]
    );

    if (userRows.length === 0) {
        throw new Error('User atau password salah.');
    }

    const user = userRows[0];

    // 2. Verifikasi password
    const isPasswordValid = (password === user.user_password);

    if (!isPasswordValid) {
        throw new Error('User atau password salah.');
    }
    
    if (user.user_aktif === 1) {
        throw new Error('User ini sudah tidak aktif.');
    }

    // 3. Jika user valid, ambil hak aksesnya
    const permissionsQuery = `
        SELECT 
            m.men_id AS id,
            m.men_nama AS name,
            m.web_route AS path,
            h.hak_men_view AS 'view',
            h.hak_men_insert AS 'insert',
            h.hak_men_edit AS 'edit',
            h.hak_men_delete AS 'delete'
        FROM thakuser h
        JOIN tmenu m ON h.hak_men_id = m.men_id
        WHERE h.hak_user_kode = ? AND m.web_route IS NOT NULL AND m.web_route <> '';
    `;
    const [permissions] = await pool.query(permissionsQuery, [user.user_kode]);


    // 4. Buat JSON Web Token (JWT)
    const tokenPayload = {
        kode: user.user_kode,
        nama: user.user_nama,
        cabang: user.user_cab,
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '8h' });

    // 5. Kembalikan semua data yang dibutuhkan frontend
    return { 
        message: 'Login berhasil',
        token,
        user: tokenPayload,
        permissions: permissions.map(p => ({
            ...p,
            view: p.view === 'Y', 
            insert: p.insert === 'Y',
            edit: p.edit === 'Y',
            delete: p.delete === 'Y'
        }))
    };
};

module.exports = {
    loginUser,
};
