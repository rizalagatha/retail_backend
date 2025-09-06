const pool = require('../config/database');
const { format } = require('date-fns');

const findById = async (nomor) => {
    const connection = await pool.getConnection();
    try {
        const headerQuery = `
            SELECT 
                sd_nomor as nomor, sd_tanggal as tanggal, sd_datekerja as tglPengerjaan,
                sd_dateline as datelineCustomer, sd_sal_kode as salesKode, sal_nama as salesNama,
                sd_cus_kode as customerKode, sd_customer as customerNama, cus_alamat as customerAlamat,
                (SELECT v.level_nama FROM tcustomer_level_history y LEFT JOIN tcustomer_level v ON v.level_kode=y.clh_level WHERE y.clh_cus_kode=h.sd_cus_kode ORDER BY y.clh_tanggal DESC LIMIT 1) as customerLevel,
                sd_jo_kode as jenisOrderKode, jo_nama as jenisOrderNama, sd_nama as namaDtf, sd_kain as kain,
                sd_finishing as finishing, sd_desain as desain, sd_workshop as workshopKode,
                pab_nama as workshopNama, sd_ket as keterangan, user_create as user
            FROM tsodtf_hdr h
            LEFT JOIN kencanaprint.tsales s ON h.sd_sal_kode = s.sal_kode
            LEFT JOIN tcustomer c ON h.sd_cus_kode = c.cus_kode
            LEFT JOIN kencanaprint.tjenisorder jo ON h.sd_jo_kode = jo.jo_kode
            LEFT JOIN kencanaprint.tpabrik p ON h.sd_workshop = p.pab_kode
            WHERE sd_nomor = ?`;
        const [headerRows] = await connection.query(headerQuery, [nomor]);
        if (headerRows.length === 0) return null;

        const detailsUkuranQuery = 'SELECT sdd_ukuran as ukuran, sdd_jumlah as jumlah, sdd_harga as harga FROM tsodtf_dtl WHERE sdd_nomor = ? ORDER BY sdd_nourut';
        const [detailsUkuranRows] = await connection.query(detailsUkuranQuery, [nomor]);

        const detailsTitikQuery = 'SELECT sdd2_ket as keterangan, sdd2_size as sizeCetak, sdd2_panjang as panjang, sdd2_lebar as lebar FROM tsodtf_dtl2 WHERE sdd2_nomor = ? ORDER BY sdd2_nourut';
        const [detailsTitikRows] = await connection.query(detailsTitikQuery, [nomor]);

        return {
            header: headerRows[0],
            detailsUkuran: detailsUkuranRows,
            detailsTitik: detailsTitikRows
        };
    } finally {
        connection.release();
    }
};

/**
 * @description Membuat nomor SO baru (getmaxnomor versi Delphi).
 * @param {object} connection - Koneksi database yang sedang aktif (dalam transaksi).
 * @param {object} data - Data dari form (diperlukan untuk tanggal dan jenis order).
 * @param {object} user - Objek user dari token (diperlukan untuk kode cabang).
 * @returns {Promise<string>} Nomor SO DTF yang baru. Contoh: K01.SD.2509.0001
 */
const generateNewSoNumber = async (connection, data, user) => {
    const tanggal = new Date(data.header.tanggal);
    const branchCode = user.cabang;
    const orderType = data.header.jenisOrderKode;

    if (!branchCode || !orderType) {
        throw new Error('Kode cabang dan jenis order harus ada untuk membuat nomor SO.');
    }
    
    // 1. Membuat prefix. Contoh: K01.SD.2509
    const datePrefix = format(tanggal, 'yyMM');
    const fullPrefix = `${branchCode}.${orderType}.${datePrefix}`;

    // 2. Query untuk mencari nomor urut maksimal, mirip seperti di Delphi.
    // CAST(... AS UNSIGNED) untuk memastikan '0009' dibandingkan sebagai angka 9.
    const query = `
        SELECT IFNULL(MAX(CAST(RIGHT(sd_nomor, 4) AS UNSIGNED)), 0) as maxNum 
        FROM tsodtf_hdr 
        WHERE LEFT(sd_nomor, ${fullPrefix.length}) = ?`;
        
    const [rows] = await connection.query(query, [fullPrefix]);
    
    // 3. Menentukan nomor urut berikutnya.
    const maxNum = rows[0].maxNum;
    const nextNum = maxNum + 1;
    
    // 4. Padding dengan nol di depan, meniru RightStr(IntToStr(10000 + ...)) Delphi.
    const sequentialPart = String(nextNum).padStart(4, '0'); // Contoh: '0001' atau '0016'
    
    // 5. Menggabungkan menjadi nomor SO lengkap.
    return `${fullPrefix}.${sequentialPart}`;
};

const create = async (data, user) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
        // Panggil fungsi generateNewSoNumber untuk mendapatkan nomor baru
        const newNomor = await generateNewSoNumber(connection, data, user);
        
        const header = data.header;
        // Simpan header dengan nomor baru
        const headerQuery = `INSERT INTO tsodtf_hdr (sd_nomor, sd_tanggal, sd_datekerja, sd_dateline, sd_cus_kode, sd_customer, sd_sal_kode, sd_jo_kode, sd_nama, sd_kain, sd_finishing, sd_desain, sd_workshop, sd_ket, user_create, date_create) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
        await connection.query(headerQuery, [newNomor, header.tanggal, header.tglPengerjaan, header.datelineCustomer, header.customerKode, header.customerNama, header.salesKode, header.jenisOrderKode, header.namaDtf, header.kain, header.finishing, header.desain, header.workshopKode, header.keterangan, user.kode]);

        // Simpan detail ukuran
        for (const [index, detail] of data.detailsUkuran.entries()) {
            const detailUkuranQuery = 'INSERT INTO tsodtf_dtl (sdd_nomor, sdd_ukuran, sdd_jumlah, sdd_harga, sdd_nourut) VALUES (?, ?, ?, ?, ?)';
            await connection.query(detailUkuranQuery, [newNomor, detail.ukuran, detail.jumlah, detail.harga, index + 1]);
        }

        // Simpan detail titik
        for (const [index, detail] of data.detailsTitik.entries()) {
            const detailTitikQuery = 'INSERT INTO tsodtf_dtl2 (sdd2_nomor, sdd2_ket, sdd2_size, sdd2_panjang, sdd2_lebar, sdd2_nourut) VALUES (?, ?, ?, ?, ?, ?)';
            await connection.query(detailTitikQuery, [newNomor, detail.keterangan, detail.sizeCetak, detail.panjang, detail.lebar, index + 1]);
        }
        
        await connection.commit();
        return { nomor: newNomor };
    } catch (error) {
        await connection.rollback();
        console.error("Error in create SO DTF service:", error);
        throw new Error('Gagal menyimpan data SO DTF baru.');
    } finally {
        connection.release();
    }
};

const update = async (nomor, data, user) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
        const header = data.header;
        const headerQuery = `UPDATE tsodtf_hdr SET sd_tanggal = ?, sd_datekerja = ?, sd_dateline = ?, sd_cus_kode = ?, sd_customer = ?, sd_sal_kode = ?, sd_jo_kode = ?, sd_nama = ?, sd_kain = ?, sd_finishing = ?, sd_desain = ?, sd_workshop = ?, sd_ket = ?, user_modified = ?, date_modified = NOW() WHERE sd_nomor = ?`;
        await connection.query(headerQuery, [header.tanggal, header.tglPengerjaan, header.datelineCustomer, header.customerKode, header.customerNama, header.salesKode, header.jenisOrderKode, header.namaDtf, header.kain, header.finishing, header.desain, header.workshopKode, header.keterangan, user.kode, nomor]);
        
        await connection.query('DELETE FROM tsodtf_dtl WHERE sdd_nomor = ?', [nomor]);
        await connection.query('DELETE FROM tsodtf_dtl2 WHERE sdd2_nomor = ?', [nomor]);

        for (const [index, detail] of data.detailsUkuran.entries()) {
            const detailUkuranQuery = 'INSERT INTO tsodtf_dtl (sdd_nomor, sdd_ukuran, sdd_jumlah, sdd_harga, sdd_nourut) VALUES (?, ?, ?, ?, ?)';
            await connection.query(detailUkuranQuery, [nomor, detail.ukuran, detail.jumlah, detail.harga, index + 1]);
        }

        for (const [index, detail] of data.detailsTitik.entries()) {
            const detailTitikQuery = 'INSERT INTO tsodtf_dtl2 (sdd2_nomor, sdd2_ket, sdd2_size, sdd2_panjang, sdd2_lebar, sdd2_nourut) VALUES (?, ?, ?, ?, ?, ?)';
            await connection.query(detailTitikQuery, [nomor, detail.keterangan, detail.sizeCetak, detail.panjang, detail.lebar, index + 1]);
        }
        
        await connection.commit();
        return { nomor };
    } catch (error) {
        await connection.rollback();
        console.error(`Error in update SO DTF service for nomor ${nomor}:`, error);
        throw new Error('Gagal memperbarui data SO DTF.');
    } finally {
        connection.release();
    }
};

const searchSales = async (term, page, itemsPerPage) => {
    const searchTerm = `%${term || ''}%`;
    const offset = (page - 1) * itemsPerPage;

    // Query untuk mengambil data dengan limit dan offset
    const dataQuery = `
        SELECT 
            sal_kode AS kode, 
            sal_nama AS nama, 
            sal_alamat AS alamat 
        FROM kencanaprint.tsales
        WHERE sal_aktif = 'Y' 
          AND (sal_kode LIKE ? OR sal_nama LIKE ?)
        ORDER BY sal_nama
        LIMIT ? OFFSET ?
    `;

    // Query untuk menghitung total hasil pencarian
    const countQuery = `
        SELECT COUNT(*) as total
        FROM kencanaprint.tsales
        WHERE sal_aktif = 'Y'
          AND (sal_kode LIKE ? OR sal_nama LIKE ?)
    `;

    const [items] = await pool.query(dataQuery, [searchTerm, searchTerm, itemsPerPage, offset]);
    const [totalRows] = await pool.query(countQuery, [searchTerm, searchTerm]);
    
    // Kembalikan data dalam format yang diharapkan frontend
    return {
        items: items,
        total: totalRows[0].total
    };
};

const searchJenisOrder = async (term) => {
    // Query ini meniru logika dari Delphi Anda
    const query = `
        SELECT 
            jo_kode AS kode, 
            jo_nama AS nama
        FROM kencanaprint.tjenisorder
        WHERE jo_divisi = 3
          AND (jo_kode LIKE ? OR jo_nama LIKE ?)
        ORDER BY jo_nama
    `;
    const searchTerm = `%${term || ''}%`;
    const [rows] = await pool.query(query, [searchTerm, searchTerm]);
    return rows;
};

const searchJenisKain = async (term, page, itemsPerPage) => {
    const searchTerm = `%${term || ''}%`;
    const offset = (page - 1) * itemsPerPage;

    const dataQuery = `
        SELECT 
            JenisKain AS nama 
        FROM retail.tjeniskain
        WHERE JenisKain LIKE ?
        ORDER BY JenisKain
        LIMIT ? OFFSET ?
    `;

    const countQuery = `
        SELECT COUNT(*) as total
        FROM retail.tjeniskain
        WHERE JenisKain LIKE ?
    `;

    const [items] = await pool.query(dataQuery, [searchTerm, parseInt(itemsPerPage), offset]);
    const [totalRows] = await pool.query(countQuery, [searchTerm]);
    
    return {
        items: items.map(row => ({ nama: row.nama })),
        total: totalRows[0].total
    };
};

const searchWorkshop = async (term) => {
    // Query ini meniru logika dari Delphi Anda
    const query = `
        SELECT 
            pab_kode AS kode, 
            pab_nama AS nama 
        FROM kencanaprint.tpabrik
        WHERE pab_kode <> 'P03'
          AND (pab_kode LIKE ? OR pab_nama LIKE ?)
        ORDER BY pab_nama
    `;
    const searchTerm = `%${term || ''}%`;
    const [rows] = await pool.query(query, [searchTerm, searchTerm]);
    return rows;
};

module.exports = {
    findById,
    create,
    update,
    searchSales,
    searchJenisOrder,
    searchJenisKain,
    searchWorkshop,
};

