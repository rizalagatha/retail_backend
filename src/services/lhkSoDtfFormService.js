const pool = require('../config/database');

const loadData = async (tanggal, cabang) => {
    const query = `
        SELECT 
            d.SoDtf AS kode,
            h.sd_nama AS nama,
            d.Depan AS depan,
            d.Belakang AS belakang,
            d.Lengan AS lengan,
            d.Variasi AS variasi,
            d.Saku AS saku,
            d.panjang AS panjang,
            d.Buangan AS buangan,
            d.Keterangan AS ket
        FROM tdtf d
        LEFT JOIN retail.tsodtf_hdr h ON h.sd_nomor = d.SoDtf
        WHERE d.tanggal = ? AND d.cab = ?
        ORDER BY h.sd_nomor
    `;
    const [rows] = await pool.query(query, [tanggal, cabang]);
    return rows;
};

const searchSoPo = async (term, cabang) => {
    // Query ini menggabungkan pencarian SO DTF (bantuankode) dan PO DTF (bantuanpo)
    const query = `
        (SELECT 
            h.sd_nomor AS kode,
            h.sd_nama AS nama,
            (SELECT SUM(sdd_jumlah) FROM retail.tsodtf_dtl WHERE sdd_nomor = h.sd_nomor) AS jumlah,
            h.sd_tanggal AS tanggal,
            'SO DTF' AS tipe
        FROM retail.tsodtf_hdr h 
        WHERE (LEFT(h.sd_nomor, 3) = ? OR sd_workshop = ?)
          AND (h.sd_nomor LIKE ? OR h.sd_nama LIKE ?)
        )
        UNION ALL
        (SELECT 
            h.pjh_nomor AS kode,
            h.pjh_ket AS nama,
            0 AS jumlah,
            h.pjh_tanggal AS tanggal,
            'PO DTF' as tipe
        FROM kencanaprint.tpodtf_hdr h
        WHERE h.pjh_kode_kaosan = ?
          AND (h.pjh_nomor LIKE ? OR h.pjh_ket LIKE ?)
        )
        ORDER BY tanggal DESC
        LIMIT 50
    `;
    const searchTerm = `%${term || ''}%`;
    const [rows] = await pool.query(query, [cabang, cabang, searchTerm, searchTerm, cabang, searchTerm, searchTerm]);
    return rows;
};

const saveData = async (data, user) => {
    const { tanggal, cabang, items } = data;
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        // Pola "delete-then-insert" seperti di Delphi
        // 1. Hapus semua data LHK untuk tanggal dan cabang ini
        await connection.query('DELETE FROM tdtf WHERE tanggal = ? AND cab = ?', [tanggal, cabang]);

        // 2. Insert semua baris baru dari grid
        for (const item of items) {
            if (item.kode && item.nama) { // Hanya simpan baris yang valid
                const insertQuery = `
                    INSERT INTO tdtf 
                    (tanggal, SoDtf, depan, belakang, lengan, variasi, saku, panjang, buangan, keterangan, cab, user_create, date_create) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                `;
                await connection.query(insertQuery, [
                    tanggal, item.kode, item.depan || 0, item.belakang || 0, item.lengan || 0,
                    item.variasi || 0, item.saku || 0, item.panjang || 0, item.buangan || 0,
                    item.ket, cabang, user.kode
                ]);
            }
        }

        await connection.commit();
        return { message: `Data LHK untuk tanggal ${tanggal} berhasil disimpan.` };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = {
    loadData,
    searchSoPo,
    saveData,
};
