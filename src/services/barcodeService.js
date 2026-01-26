const pool = require("../config/database");

const getBarcodeHeaders = async (startDate, endDate, cabang) => {
  let query = `
        SELECT h.bch_nomor AS nomor, h.bch_tanggal AS tanggal, h.user_create AS user
        FROM tbarcode_hdr h
        WHERE h.bch_tanggal BETWEEN ? AND ?
    `;
  const params = [startDate, endDate];

  // Jika bukan KDC, batasi hanya cabang miliknya.
  // Jika KDC, biarkan melihat semua
  if (cabang !== "KDC") {
    query += " AND LEFT(h.bch_nomor, 3) = ?";
    params.push(cabang);
  }

  query += " ORDER BY h.bch_tanggal DESC, h.bch_nomor DESC";
  const [rows] = await pool.query(query, params);
  return rows;
};

const getBarcodeDetails = async (nomor) => {
  const query = `
        SELECT 
            d.bcd_nomor AS nomor,
            a.brg_kode AS kode,
            b.brgd_barcode AS barcode,
            CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna) AS nama,
            d.bcd_ukuran AS ukuran,
            d.bcd_jumlah AS jumlah
        FROM tbarcode_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.bcd_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.bcd_kode AND b.brgd_ukuran = d.bcd_ukuran
        WHERE d.bcd_nomor = ?
        ORDER BY d.bcd_nourut;
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

// Fungsi untuk save dan delete bisa ditambahkan di sini nanti

module.exports = {
  getBarcodeHeaders,
  getBarcodeDetails,
};
