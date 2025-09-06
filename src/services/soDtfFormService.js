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

const generateNewSoNumber = async (connection, data, user) => {
    const tanggal = new Date(data.header.tanggal);
    const prefix = `${user.cabang}.${data.header.jenisOrderKode}.${format(tanggal, 'yyMM')}`;
    const query = `SELECT MAX(RIGHT(sd_nomor, 4)) as maxNum FROM tsodtf_hdr WHERE sd_nomor LIKE ?`;
    const [rows] = await connection.query(query, [`${prefix}%`]);
    const nextNum = rows[0].maxNum ? parseInt(rows[0].maxNum, 10) + 1 : 1;
    return `${prefix}.${nextNum.toString().padStart(4, '0')}`;
};

const create = async (data, user) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
        const newNomor = await generateNewSoNumber(connection, data, user);
        
        const header = data.header;
        const headerQuery = `INSERT INTO tsodtf_hdr (sd_nomor, sd_tanggal, sd_datekerja, sd_dateline, sd_cus_kode, sd_customer, sd_sal_kode, sd_jo_kode, sd_nama, sd_kain, sd_finishing, sd_desain, sd_workshop, sd_ket, user_create, date_create) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
        await connection.query(headerQuery, [newNomor, header.tanggal, header.tglPengerjaan, header.datelineCustomer, header.customerKode, header.customerNama, header.salesKode, header.jenisOrderKode, header.namaDtf, header.kain, header.finishing, header.desain, header.workshopKode, header.keterangan, user.kode]);

        for (const [index, detail] of data.detailsUkuran.entries()) {
            const detailUkuranQuery = 'INSERT INTO tsodtf_dtl (sdd_nomor, sdd_ukuran, sdd_jumlah, sdd_harga, sdd_nourut) VALUES (?, ?, ?, ?, ?)';
            await connection.query(detailUkuranQuery, [newNomor, detail.ukuran, detail.jumlah, detail.harga, index + 1]);
        }

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

module.exports = {
    findById,
    create,
    update,
};

