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
        
        // Pola "Hapus-lalu-Sisipkan" untuk detail
        await connection.query('DELETE FROM tso_dtl WHERE sod_so_nomor = ?', [soNomor]);
        for (const [index, item] of details.entries()) {
            // INSERT ke tso_dtl
        }

        // Simpan/Update Header
        if (isNew) {
            // INSERT ke tso_hdr
        } else {
            // UPDATE tso_hdr
        }
        
        // Simpan data PIN ke totorisasi (simpanpin)
        // ...

        // Update nomor SO di setoran (simpannoso)
        if (dps && dps.length > 0) {
            const noSetoran = dps.map(dp => dp.nomor);
            await connection.query('UPDATE tsetor_hdr SET sh_so_nomor = ? WHERE sh_nomor IN (?)', [soNomor, noSetoran]);
        }

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

// ... (Implementasi fungsi-fungsi lookup/bantuan lainnya)

module.exports = {
    save,
    getSoForEdit,
    // ...
};
