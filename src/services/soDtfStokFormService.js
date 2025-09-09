const pool = require('../config/database');
const { format } = require('date-fns');

// Fungsi untuk mengambil template grid (dari edtjoExit)
const getTemplateItems = async (jenisOrder) => {
    const brg_kode = jenisOrder === 'SD' ? '2500053' : '2500060'; // SD=DTF, DP=DTF Premium
    const query = `
        SELECT 
            b.brgd_kode AS kode,
            a.brg_warna AS nama,
            b.brgd_ukuran AS ukuran,
            c.us_panjang AS panjang,
            c.us_lebar AS lebar
        FROM retail.tbarangdc_dtl b
        JOIN retail.tbarangdc a ON a.brg_kode = b.brgd_kode
        LEFT JOIN tukuran_sodtf c ON c.us_ukuran = b.brgd_ukuran AND c.us_jenis = ?
        WHERE a.brg_aktif = 0 AND a.brg_logstok = "Y" AND a.brg_kode = ?
    `;
    const [rows] = await pool.query(query, [jenisOrder, brg_kode]);
    // Tambahkan field jumlah = 0
    return rows.map(row => ({ ...row, jumlah: 0 }));
};

// Fungsi untuk memuat data saat mode Ubah (dari loaddataall)
const loadDataForEdit = async (nomor) => {
    const [headerRows] = await pool.query('SELECT h.*, s.sal_nama, j.jo_nama, g.pab_nama FROM tsodtf_hdr h LEFT JOIN kencanaprint.tsales s ON s.sal_kode=h.sd_sal_kode LEFT JOIN kencanaprint.tjenisorder j ON j.jo_kode=h.sd_jo_kode LEFT JOIN kencanaprint.tpabrik g ON g.pab_kode=h.sd_workshop WHERE h.sd_nomor = ?', [nomor]);
    if (headerRows.length === 0) throw new Error('Data tidak ditemukan.');
    
    const [detailRows] = await pool.query('SELECT * FROM tsodtf_stok WHERE sds_nomor = ? ORDER BY sds_nourut', [nomor]);
    
    // TODO: Logika untuk gambar
    
    return {
        header: headerRows[0],
        details: detailRows
    };
};

// Fungsi untuk menyimpan data (dari simpandata)
const saveData = async (nomor, data, user) => {
    const { header, details } = data;
    const isEdit = !!nomor;
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        let currentNomor = nomor;
        if (!isEdit) {
            // Logika getmaxnomor
            const prefix = `${user.cabang}.${header.jenisOrderKode}.${format(new Date(header.tanggal), 'yyMM')}`;
            const [maxRows] = await connection.query(`SELECT IFNULL(MAX(CAST(RIGHT(sd_nomor, 4) AS UNSIGNED)), 0) as maxNum FROM tsodtf_hdr WHERE LEFT(sd_nomor, ${prefix.length}) = ?`, [prefix]);
            const nextNum = maxRows[0].maxNum + 1;
            currentNomor = `${prefix}.${String(nextNum).padStart(4, '0')}`;
        }

        if (isEdit) {
            // UPDATE HEADER
            const updateQuery = `UPDATE tsodtf_hdr SET sd_datekerja = ?, sd_sal_kode = ?, sd_jo_kode = ?, sd_nama = ?, sd_desain = ?, sd_workshop = ?, sd_ket = ?, user_modified = ?, date_modified = NOW() WHERE sd_nomor = ?`;
            await connection.query(updateQuery, [header.tglPengerjaan, header.salesKode, header.jenisOrderKode, header.namaDtf, header.desain, header.workshopKode, header.keterangan, user.kode, currentNomor]);
        } else {
            // INSERT HEADER
            const insertQuery = `INSERT INTO tsodtf_hdr (sd_nomor, sd_tanggal, sd_datekerja, sd_sal_kode, sd_jo_kode, sd_nama, sd_desain, sd_workshop, sd_ket, sd_stok, user_create, date_create) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, "Y", ?, NOW())`;
            await connection.query(insertQuery, [currentNomor, header.tanggal, header.tglPengerjaan, header.salesKode, header.jenisOrderKode, header.namaDtf, header.desain, header.workshopKode, header.keterangan, user.kode]);
        }
        
        // Pola "delete-then-insert" untuk detail
        await connection.query('DELETE FROM tsodtf_stok WHERE sds_nomor = ?', [currentNomor]);
        for (const [index, item] of details.entries()) {
            const detailQuery = `INSERT INTO tsodtf_stok (sds_nomor, sds_kode, sds_ukuran, sds_panjang, sds_lebar, sds_jumlah, sds_nourut) VALUES (?, ?, ?, ?, ?, ?, ?)`;
            await connection.query(detailQuery, [currentNomor, item.kode, item.ukuran, item.panjang || 0, item.lebar || 0, item.jumlah || 0, index + 1]);
        }

        await connection.commit();
        return { message: 'Data berhasil disimpan.', nomor: currentNomor };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const searchJenisOrderStok = async (term) => {
    // Query ini meniru logika dari edtjoKeyDown di Delphi
    const query = `
        SELECT 
            jo_kode AS kode, 
            jo_nama AS nama 
        FROM kencanaprint.tjenisorder
        WHERE jo_kode IN ('SD', 'DP') 
          AND (jo_kode LIKE ? OR jo_nama LIKE ?)
        ORDER BY jo_nama
    `;
    const searchTerm = `%${term || ''}%`;
    const [rows] = await pool.query(query, [searchTerm, searchTerm]);
    return rows;
};

module.exports = {
    getTemplateItems,
    loadDataForEdit,
    saveData,
    searchJenisOrderStok,
};
