const pool = require('../config/database');

const getPrintData = async (nomor) => {
    // Query ini diadaptasi dari query 'cetak' di Delphi Anda
    const query = `
        SELECT 
            h.mi_nomor, h.mi_tanggal, h.mi_so_nomor, h.mi_ket,
            i.mo_kecab AS dari_cabang_kode,
            p.pab_nama AS dari_cabang_nama,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d.mid_kode, d.mid_ukuran, d.mid_jumlah,
            DATE_FORMAT(h.date_create, "%d-%m-%Y %T") AS created,
            h.user_create,
            src.gdg_inv_nama AS perush_nama,
            src.gdg_inv_alamat AS perush_alamat,
            src.gdg_inv_telp AS perush_telp
        FROM tmutasiin_hdr h
        LEFT JOIN tmutasiin_dtl d ON d.mid_nomor = h.mi_nomor
        LEFT JOIN tmutasiout_hdr i ON i.mo_nomor = h.mi_mo_nomor
        LEFT JOIN kencanaprint.tpabrik p ON p.pab_kode = i.mo_kecab
        LEFT JOIN tbarangdc a ON a.brg_kode = d.mid_kode
        LEFT JOIN tgudang src ON src.gdg_kode = LEFT(h.mi_nomor, 3)
        WHERE h.mi_nomor = ?
        ORDER BY d.mid_kode, d.mid_ukuran;
    `;
    
    const [rows] = await pool.query(query, [nomor]);
    if (rows.length === 0) {
        throw new Error('Data Mutasi In tidak ditemukan.');
    }

    const header = { ...rows[0] };
    const details = rows.map(row => ({
        mid_kode: row.mid_kode,
        nama: row.nama,
        mid_ukuran: row.mid_ukuran,
        mid_jumlah: row.mid_jumlah,
    }));

    return { header, details };
};

module.exports = {
    getPrintData,
};
