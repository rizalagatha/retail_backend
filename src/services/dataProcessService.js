const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid'); // Untuk generate ID unik

/**
 * Proses 1: Insert Penjualan Detail Piutang
 * Mencari header piutang yang belum memiliki detail "Penjualan" dan menambahkannya.
 */
const insertSalesDetails = async () => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [headers] = await connection.query(`
            SELECT h.ph_nomor, h.ph_tanggal, h.ph_nominal 
            FROM tpiutang_hdr h 
            WHERE NOT EXISTS (
                SELECT 1 FROM tpiutang_dtl d 
                WHERE d.pd_ph_nomor = h.ph_nomor AND d.pd_uraian = 'Penjualan'
            )
        `);

        let insertedCount = 0;
        for (const header of headers) {
            const uniqueId = `INV${new Date().getTime()}${insertedCount}`;
            await connection.query(
                `INSERT INTO tpiutang_dtl (pd_sd_angsur, pd_ph_nomor, pd_tanggal, pd_uraian, pd_debet) 
                 VALUES (?, ?, ?, 'Penjualan', ?)`,
                [uniqueId, header.ph_nomor, header.ph_tanggal, header.ph_nominal]
            );
            insertedCount++;
        }

        await connection.commit();
        return { success: true, message: `${insertedCount} detail penjualan berhasil ditambahkan.` };
    } catch (error) {
        await connection.rollback();
        console.error("Error in insertSalesDetails:", error);
        throw new Error('Proses Insert Penjualan Detail Piutang gagal.');
    } finally {
        connection.release();
    }
};

/**
 * Proses 2: Insert Bayar Tunai Langsung Detail Piutang
 * Mencari invoice tunai yang belum memiliki detail pembayaran dan menambahkannya.
 */
const insertCashPaymentDetails = async () => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [invoices] = await connection.query(`
            SELECT p.ph_nomor, p.ph_tanggal, h.inv_rptunai, p.ph_nominal
            FROM tinv_hdr h
            INNER JOIN tpiutang_hdr p ON p.ph_inv_nomor = h.inv_nomor
            WHERE h.inv_rptunai <> 0 
            AND NOT EXISTS (
                SELECT 1 FROM tpiutang_dtl d 
                WHERE d.pd_ph_nomor = p.ph_nomor AND d.pd_uraian = 'Bayar Tunai Langsung'
            )
        `);

        let insertedCount = 0;
        for (const inv of invoices) {
            const paymentAmount = Math.min(inv.inv_rptunai, inv.ph_nominal);
            const uniqueId = `CASH${new Date().getTime()}${insertedCount}`;
            await connection.query(
                `INSERT INTO tpiutang_dtl (pd_sd_angsur, pd_ph_nomor, pd_tanggal, pd_uraian, pd_kredit) 
                 VALUES (?, ?, ?, 'Bayar Tunai Langsung', ?)`,
                [uniqueId, inv.ph_nomor, inv.ph_tanggal, paymentAmount]
            );
            insertedCount++;
        }

        await connection.commit();
        return { success: true, message: `${insertedCount} detail pembayaran tunai berhasil ditambahkan.` };
    } catch (error) {
        await connection.rollback();
        console.error("Error in insertCashPaymentDetails:", error);
        throw new Error('Proses Insert Bayar Tunai Langsung gagal.');
    } finally {
        connection.release();
    }
};


module.exports = {
    insertSalesDetails,
    insertCashPaymentDetails,
};
