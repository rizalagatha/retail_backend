const pool = require("../config/database");

const getList = async (filters) => {
  const { startDate, endDate, cabang } = filters;

  let query = `
        SELECT 
            h.gr_nomor AS nomor,
            h.gr_tanggal AS tanggal,
            h.gr_tl_nomor AS nomorTolak,
            t.tl_stbj AS stbj,
            h.gr_terima AS nomorTerima,
            h.gr_tglterima AS tglTerima,
            h.gr_gudang AS gudang,
            g.gdg_nama AS namaGudang,
            h.gr_cab AS cabang,
            h.user_create
        FROM tdc_gr_hdr h
        LEFT JOIN tgudang g ON g.gdg_kode = h.gr_gudang
        LEFT JOIN tdc_stbjtolak t ON t.tl_nomor = h.gr_tl_nomor
        WHERE h.gr_tanggal BETWEEN ? AND ?
    `;
  const params = [startDate, endDate];

  if (cabang && cabang !== "ALL") {
    query += " AND h.gr_cab = ?";
    params.push(cabang);
  }
  query += " ORDER BY h.gr_terima, h.gr_nomor;";

  const [rows] = await pool.query(query, params);
  return rows;
};

const getDetails = async (nomor) => {
  const query = `
        SELECT 
            d.grd_spk_nomor AS spk,
            d.grd_kode AS kode,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
            d.grd_ukuran AS ukuran,
            d.grd_jumlah AS jumlah
        FROM tdc_gr_dtl d
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.grd_kode
        WHERE d.grd_nomor = ?
        ORDER BY d.grd_spk_nomor, d.grd_kode, d.grd_ukuran;
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

const cancelReceipt = async (nomorKirim) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Ambil nomor terima dari dokumen pengiriman
    const [rows] = await connection.query(
      "SELECT gr_terima FROM tdc_gr_hdr WHERE gr_nomor = ?",
      [nomorKirim]
    );
    if (rows.length === 0 || !rows[0].gr_terima) {
      throw new Error("Dokumen ini belum diterima.");
    }
    const nomorTerima = rows[0].gr_terima;

    // --- PROSES PEMBATALAN ---
    // 1. Hapus detail penerimaan (tdc_gr_dtl2)
    await connection.query("DELETE FROM tdc_gr_dtl2 WHERE grd2_nomor = ?", [
      nomorTerima,
    ]);

    // 2. Hapus dokumen SJ dan Mutasi yang dibuat otomatis (jika ada)
    await connection.query("DELETE FROM tdc_sj_hdr WHERE sj_stbj = ?", [
      nomorKirim,
    ]);
    await connection.query("DELETE FROM tdc_mts_hdr WHERE mts_stbj = ?", [
      nomorKirim,
    ]);

    // 3. Update header pengiriman untuk hapus referensi
    await connection.query(
      'UPDATE tdc_gr_hdr SET gr_terima = "", gr_tglterima = NULL WHERE gr_nomor = ?',
      [nomorKirim]
    );

    await connection.commit();
    return { message: `Penerimaan untuk ${nomorKirim} berhasil dibatalkan.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getExportDetails = async (filters) => {
    // Implementasi lengkap untuk export detail
    const { startDate, endDate, cabang } = filters;
    let query = `
        SELECT 
            h.gr_nomor AS 'Nomor Kirim', h.gr_tanggal AS 'Tanggal Kirim',
            h.gr_terima AS 'Nomor Terima', h.gr_tglterima AS 'Tanggal Terima',
            g.gdg_nama AS 'Dari Gudang', h.gr_cab AS 'Cabang Tujuan',
            d.grd_spk_nomor AS 'SPK', d.grd_kode AS 'Kode Barang',
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS 'Nama Barang',
            d.grd_ukuran AS 'Ukuran', d.grd_jumlah AS 'Jumlah'
        FROM tdc_gr_hdr h
        LEFT JOIN tdc_gr_dtl d ON d.grd_nomor = h.gr_nomor
        LEFT JOIN tgudang g ON g.gdg_kode = h.gr_gudang
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.grd_kode
        WHERE h.gr_tanggal BETWEEN ? AND ?
    `;
    const params = [startDate, endDate];

    if (cabang && cabang !== 'ALL') {
        query += ' AND h.gr_cab = ?';
        params.push(cabang);
    }
    query += ' ORDER BY h.gr_nomor, d.grd_spk_nomor, d.grd_kode, d.grd_ukuran;';
    const [rows] = await pool.query(query, params);
    return rows;
};

module.exports = { getList, getDetails, cancelReceipt, getExportDetails };
