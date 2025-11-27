const pool = require("../config/database");

// Fungsi untuk memuat data dari dokumen pengiriman
const loadFromKirim = async (nomorKirim) => {
  const query = `
    SELECT 
        h.msk_nomor, h.msk_tanggal, h.msk_ket,
        h.msk_cab AS gudangAsalKode,
        g.gdg_nama AS gudangAsalNama,
        d.mskd_kode AS kode,
        b.brgd_barcode AS barcode,
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
        d.mskd_ukuran AS ukuran,
        d.mskd_jumlah AS jumlahKirim
    FROM tmsk_hdr h
    INNER JOIN tmsk_dtl d ON d.mskd_nomor = h.msk_nomor
    LEFT JOIN tbarangdc a ON a.brg_kode = d.mskd_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.mskd_kode AND b.brgd_ukuran = d.mskd_ukuran
    LEFT JOIN tgudang g ON g.gdg_kode = h.msk_cab
    WHERE h.msk_nomor = ?;
    `;
  const [rows] = await pool.query(query, [nomorKirim]);
  if (rows.length === 0) throw new Error("Dokumen pengiriman tidak ditemukan.");

  const header = {
    nomorKirim: rows[0].msk_nomor,
    tanggalKirim: rows[0].msk_tanggal,
    gudangAsalKode: rows[0].gudangAsalKode,
    gudangAsalNama: rows[0].gudangAsalNama,
    keterangan: rows[0].msk_ket,
  };
  const items = rows.map((row) => ({
    kode: row.kode,
    barcode: row.barcode,
    nama: row.nama,
    ukuran: row.ukuran,
    jumlahKirim: row.jumlahKirim,
  }));
  return { header, items };
};

// Fungsi untuk menyimpan data penerimaan
const save = async (payload, user) => {
  const { header, items } = payload;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const year = new Date(header.tanggalTerima)
      .getFullYear()
      .toString()
      .substring(2);
    const prefix = `${user.cabang}.MST.${year}`;
    const nomorQuery = `SELECT IFNULL(MAX(RIGHT(mst_nomor, 5)), 0) + 1 AS next_num FROM tmst_hdr WHERE LEFT(mst_nomor, 10) = ?;`;
    const [nomorRows] = await connection.query(nomorQuery, [prefix]);
    const nextNum = nomorRows[0].next_num.toString().padStart(5, "0");
    const nomorTerima = `${prefix}${nextNum}`;

    const headerInsertQuery = `
        INSERT INTO tmst_hdr (mst_nomor, mst_tanggal, user_create, date_create)
        VALUES (?, ?, ?, NOW());
        `;
    await connection.query(headerInsertQuery, [
      nomorTerima,
      header.tanggalTerima,
      user.kode,
    ]);

    await connection.query(
      "UPDATE tmsk_hdr SET msk_noterima = ? WHERE msk_nomor = ?",
      [nomorTerima, header.nomorKirim]
    );

    const itemValues = items.map((item) => [
      nomorTerima,
      item.kode,
      item.ukuran,
      item.jumlahTerima,
    ]);
    if (itemValues.length > 0) {
      const itemInsertQuery = `INSERT INTO tmst_dtl (mstd_nomor, mstd_kode, mstd_ukuran, mstd_jumlah) VALUES ?;`;
      await connection.query(itemInsertQuery, [itemValues]);
    }

    await connection.commit();
    return {
      message: `Penerimaan berhasil disimpan dengan nomor ${nomorTerima}`,
      nomor: nomorTerima,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { loadFromKirim, save };
