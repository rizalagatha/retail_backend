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
    LEFT JOIN tdcrb_hdr t ON t.rb_nomor = h.rb_noterima
    LEFT JOIN tgudang g ON g.gdg_kode = h.rb_kecab
    WHERE 
      h.rb_cab = ? 
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
    LEFT JOIN tdcrb_dtl r ON r.rbd_nomor = h.rb_noterima AND r.rbd_kode = d.rbd_kode AND r.rbd_ukuran = d.rbd_ukuran
    LEFT JOIN tbarangdc a ON a.brg_kode = d.rbd_kode
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
      "SELECT rb_noterima, rb_closing, rb_cab AS cabang FROM trbdc_hdr WHERE rb_nomor = ?",
      [nomor],
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

const getExportDetails = async (filters, user) => {
  const { startDate, endDate, cabang } = filters;

  let whereClauses = [];
  let params = [];

  // 1. Filter Cabang
  // Jika user adalah KDC, cek filter dari frontend
  if (user.cabang === "KDC") {
    if (cabang && cabang !== "ALL") {
      whereClauses.push("h.rb_cab = ?");
      params.push(cabang);
    }
    // Jika ALL, tidak perlu filter cabang (ambil semua)
  } else {
    // Jika user adalah Cabang (Store), paksa filter ke cabangnya sendiri
    whereClauses.push("h.rb_cab = ?");
    params.push(user.cabang);
  }

  // 2. Filter Tanggal (Gunakan DATE agar jam diabaikan)
  whereClauses.push("DATE(h.rb_tanggal) BETWEEN ? AND ?");
  params.push(startDate, endDate);

  const query = `
    SELECT 
      h.rb_nomor AS 'Nomor Retur',
      h.rb_tanggal AS 'Tanggal',
      f.gdg_nama AS 'Dari Cabang',
      g.gdg_nama AS 'Ke Gudang DC',
      h.rb_ket AS 'Keterangan Header',
      h.rb_noterima AS 'Nomor Terima',
      d.rbd_kode AS 'Kode Barang',
      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS 'Nama Barang',
      d.rbd_ukuran AS 'Ukuran',
      d.rbd_jumlah AS 'Jumlah'
    FROM trbdc_hdr h
    INNER JOIN trbdc_dtl d ON d.rbd_nomor = h.rb_nomor
    LEFT JOIN tgudang f ON f.gdg_kode = h.rb_cab
    LEFT JOIN tgudang g ON g.gdg_kode = h.rb_kecab
    LEFT JOIN tbarangdc a ON a.brg_kode = d.rbd_kode
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY h.rb_tanggal, h.rb_nomor;
  `;

  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = { getList, getDetails, remove, getExportDetails };
