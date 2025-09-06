const pool = require('../config/database');

/**
 * Mengambil daftar semua jenis kaos beserta harga per ukuran.
 * Menerjemahkan query dari btnRefreshClick di Delphi.
 */
const getAllTshirtTypes = async () => {
  const query = `
    SELECT 
      j.jk_Jenis AS JenisKaos,
      j.jk_custom AS Custom,
      j.jk_s AS Harga_S, j.jk_m AS Harga_M, j.jk_l AS Harga_L,
      j.jk_xl AS Harga_XL, j.jk_2xl AS Harga_2XL, j.jk_3xl AS Harga_3XL,
      j.jk_4xl AS Harga_4XL, j.jk_5xl AS Harga_5XL
      /* Tambahkan kolom harga lain jika ada (6XL, dst.) */
    FROM tjeniskaos j
    ORDER BY j.jk_Jenis, j.jk_custom DESC;
  `;
  const [rows] = await pool.query(query);
  return rows;
};

/**
 * Mengambil template ukuran default untuk form baru.
 * Menerjemahkan query dari FormCreate di Delphi.
 */
const getUkuranTemplate = async () => {
    const query = `SELECT ukuran FROM tukuran WHERE kategori="" AND kode>=2 AND kode<=16 ORDER BY kode`;
    const [rows] = await pool.query(query);
    return rows;
};

/**
 * Mengambil detail harga untuk satu jenis kaos spesifik (untuk mode edit).
 * Menerjemahkan logika dari cxButton1Click di Delphi.
 */
const getTshirtTypeDetails = async (jenisKaos, custom) => {
    const query = `SELECT * FROM tjeniskaos WHERE jk_Jenis = ? AND jk_custom = ?`;
    const [rows] = await pool.query(query, [jenisKaos, custom]);
    if (rows.length === 0) {
        throw new Error('Jenis kaos tidak ditemukan.');
    }
    const data = rows[0];

    // Mengubah data dari format kolom (jk_s, jk_m) menjadi format baris [{ukuran, harga}]
    const ukuranHarga = [
        { ukuran: 'S', harga: data.jk_s },
        { ukuran: 'M', harga: data.jk_m },
        { ukuran: 'L', harga: data.jk_l },
        { ukuran: 'XL', harga: data.jk_xl },
        { ukuran: '2XL', harga: data.jk_2xl },
        { ukuran: '3XL', harga: data.jk_3xl },
        { ukuran: '4XL', harga: data.jk_4xl },
        { ukuran: '5XL', harga: data.jk_5xl },
        // Tambahkan ukuran lain jika ada
    ];

    return {
        jenisKaos: data.jk_Jenis,
        custom: data.jk_custom,
        ukuranHarga: ukuranHarga
    };
};

/**
 * Menyimpan data (insert baru atau update yang sudah ada).
 * Menerjemahkan query dari simpandata di Delphi.
 */
const saveTshirtType = async (data) => {
    const { jenisKaos, custom, ukuranHarga } = data;

    // Ubah array ukuranHarga menjadi objek agar mudah diakses
    const hargaMap = ukuranHarga.reduce((acc, item) => {
        acc[item.ukuran] = item.harga || 0;
        return acc;
    }, {});

    const query = `
        INSERT INTO tjeniskaos (
            jk_Jenis, jk_custom, 
            jk_s, jk_m, jk_l, jk_xl, jk_2xl, jk_3xl, jk_4xl, jk_5xl
            /* Tambahkan jk_6xl, dst. di sini */
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ? /* Tambahkan '?' untuk setiap kolom baru */)
        ON DUPLICATE KEY UPDATE
            jk_s = VALUES(jk_s), jk_m = VALUES(jk_m), jk_l = VALUES(jk_l),
            jk_xl = VALUES(jk_xl), jk_2xl = VALUES(jk_2xl), jk_3xl = VALUES(jk_3xl),
            jk_4xl = VALUES(jk_4xl), jk_5xl = VALUES(jk_5xl)
            /* Tambahkan 'jk_6xl = VALUES(jk_6xl)', dst. di sini */
    `;

    const params = [
        jenisKaos, custom,
        hargaMap['S'], hargaMap['M'], hargaMap['L'], hargaMap['XL'], 
        hargaMap['2XL'], hargaMap['3XL'], hargaMap['4XL'], hargaMap['5XL']
        // Tambahkan harga untuk ukuran lain di sini
    ];

    await pool.query(query, params);
    return { message: 'Data harga berhasil disimpan.' };
};

/**
 * Menghapus data jenis kaos.
 * Menerjemahkan query dari cxButton4Click di Delphi.
 */
const deleteTshirtType = async (jenisKaos, custom) => {
    const query = `DELETE FROM tjeniskaos WHERE jk_Jenis = ? AND jk_custom = ?`;
    const [result] = await pool.query(query, [jenisKaos, custom]);

    if (result.affectedRows === 0) {
        throw new Error('Gagal menghapus, data tidak ditemukan.');
    }
    return { message: 'Data berhasil dihapus.' };
};


module.exports = {
    getAllTshirtTypes,
    getUkuranTemplate,
    getTshirtTypeDetails,
    saveTshirtType,
    deleteTshirtType,
};
