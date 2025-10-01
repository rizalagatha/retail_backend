const pool = require("../config/database");

const getList = async (filters, user) => {
  const { startDate, endDate, cabang } = filters;

  // Query Master dari Delphi
  const query = `
        SELECT 
            h.rb_nomor AS nomor,
            h.rb_tanggal AS tanggal,
            h.rb_noterima AS nomorTerima,
            t.rb_tanggal AS tglTerima,
            t.rb_koreksi AS noKoreksi,
            h.rb_kecab AS kecab,
            g.gdg_nama AS gudangDc,
            h.rb_ket AS keterangan,
            h.rb_closing AS closing
        FROM trbdc_hdr h
        LEFT JOIN retail.tdcrb_hdr t ON t.rb_nomor = h.rb_noterima
        LEFT JOIN tgudang g ON g.gdg_kode = h.rb_kecab
        WHERE 
            LEFT(h.rb_nomor, 3) = ? 
            AND h.rb_tanggal BETWEEN ? AND ?
        ORDER BY h.rb_tanggal DESC, h.rb_nomor DESC;
    `;
  const params = [cabang, startDate, endDate];
  const [rows] = await pool.query(query, params);
  return rows;
};

const getDetails = async (nomor) => {
  // Query Detail dari Delphi
  const query = `
        SELECT 
            d.rbd_kode AS kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d.rbd_ukuran AS ukuran,
            IF(d.rbd_input <> 0, d.rbd_input, d.rbd_jumlah) AS jumlah,
            IFNULL(r.rbd_jumlah, 0) AS terima,
            (IFNULL(r.rbd_jumlah, 0) - IF(d.rbd_input <> 0, d.rbd_input, d.rbd_jumlah)) AS selisih
        FROM trbdc_dtl d
        INNER JOIN trbdc_hdr h ON d.rbd_nomor = h.rb_nomor
        LEFT JOIN retail.tdcrb_dtl r ON r.rbd_nomor = h.rb_noterima AND r.rbd_kode = d.rbd_kode AND r.rbd_ukuran = d.rbd_ukuran
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.rbd_kode
        WHERE d.rbd_nomor = ?;
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

const remove = async (nomor, user) => {
  // Logika hapus dari Delphi
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT rb_noterima, rb_closing, LEFT(rb_nomor, 3) AS cabang FROM trbdc_hdr WHERE rb_nomor = ?",
      [nomor]
    );
    if (rows.length === 0) throw new Error("Dokumen tidak ditemukan.");
    const doc = rows[0];

    if (doc.rb_noterima)
      throw new Error("Sudah ada penerimaan. Tidak bisa dihapus.");
    if (doc.cabang !== user.cabang)
      throw new Error("Anda tidak berhak menghapus data cabang lain.");
    if (doc.rb_closing === "Y")
      throw new Error("Sudah Closing. Tidak bisa dihapus.");

    await connection.query("DELETE FROM trbdc_dtl WHERE rbd_nomor = ?", [
      nomor,
    ]);
    await connection.query("DELETE FROM trbdc_hdr WHERE rb_nomor = ?", [nomor]);

    await connection.commit();
    return { message: `Dokumen ${nomor} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { getList, getDetails, remove };
