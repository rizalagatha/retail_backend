const pool = require("../config/database");

const generateNomorKoreksi = async (connection, gudang, tanggal) => {
  const yearMonth = new Date(tanggal)
    .toISOString()
    .slice(2, 7)
    .replace("-", "");
  const prefix = `${gudang}.KOR.${yearMonth}.`;
  const query = `SELECT IFNULL(MAX(RIGHT(kor_nomor, 4)), 0) + 1 AS next_num FROM tkor_hdr WHERE LEFT(kor_nomor, 12) = ?;`;
  const [rows] = await connection.query(query, [prefix]);
  const nextNum = rows[0].next_num.toString().padStart(4, "0");
  return `${prefix}${nextNum}`;
};

// Fungsi untuk memuat data dari dokumen Retur ke DC (meniru loadterima)
const loadFromKirim = async (nomorReturDc) => {
  const query = `
        SELECT 
            h.rb_nomor, h.rb_tanggal, h.rb_ket,
            LEFT(h.rb_nomor, 3) AS gudangAsalKode,
            g.gdg_nama AS gudangAsalNama,
            d.rbd_kode AS kode,
            b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d.rbd_ukuran AS ukuran,
            d.rbd_jumlah AS jumlahKirim
        FROM trbdc_hdr h
        INNER JOIN trbdc_dtl d ON d.rbd_nomor = h.rb_nomor
        LEFT JOIN tbarangdc a ON a.brg_kode = d.rbd_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.rbd_kode AND b.brgd_ukuran = d.rbd_ukuran
        LEFT JOIN tgudang g ON g.gdg_kode = LEFT(h.rb_nomor, 3)
        WHERE h.rb_nomor = ?;
    `;
  const [rows] = await pool.query(query, [nomorReturDc]);
  if (rows.length === 0)
    throw new Error("Dokumen Retur ke DC tidak ditemukan.");

  const header = {
    nomorRb: rows[0].rb_nomor,
    tanggalRb: rows[0].rb_tanggal,
    gudangAsalKode: rows[0].gudangAsalKode,
    gudangAsalNama: rows[0].gudangAsalNama,
    keterangan: rows[0].rb_ket,
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

    // 1. Buat dokumen header penerimaan (tdcrb_hdr)
    const yearMonth = new Date(header.tanggal)
      .toISOString()
      .slice(2, 7)
      .replace("-", "");
    const prefix = `KDC.RB.${yearMonth}.`;
    const nomorQuery = `SELECT IFNULL(MAX(RIGHT(rb_nomor, 4)), 0) + 1 AS next_num FROM tdcrb_hdr WHERE LEFT(rb_nomor, 11) = ?;`;
    const [nomorRows] = await connection.query(nomorQuery, [prefix]);
    const nomorDokumen = `${prefix}${nomorRows[0].next_num
      .toString()
      .padStart(4, "0")}`;

    await connection.query(
      "INSERT INTO tdcrb_hdr (rb_nomor, rb_tanggal, user_create, date_create) VALUES (?, ?, ?, NOW())",
      [nomorDokumen, header.tanggal, user.kode]
    );

    // 2. Update dokumen pengiriman asli (trbdc_hdr)
    await connection.query(
      "UPDATE trbdc_hdr SET rb_noterima = ? WHERE rb_nomor = ?",
      [nomorDokumen, header.nomorRb]
    );

    // 3. Simpan detail penerimaan (tdcrb_dtl)
    if (items.length > 0) {
      const itemValues = items.map((item, index) => [
        nomorDokumen + (index + 1),
        nomorDokumen,
        item.kode,
        item.ukuran,
        item.terima,
      ]);
      await connection.query(
        "INSERT INTO tdcrb_dtl (rbd_iddrec, rbd_nomor, rbd_kode, rbd_ukuran, rbd_jumlah) VALUES ?",
        [itemValues]
      );
    }

    // --- 4. LOGIKA KOREKSI OTOMATIS JIKA ADA SELISIH ---
    const selisihItems = items.filter(
      (i) => (i.terima || 0) !== (i.jumlah || 0)
    );

    if (selisihItems.length > 0) {
      // Panggil fungsi generate nomor koreksi
      const nomorKoreksi = await generateNomorKoreksi(
        connection,
        user.cabang,
        header.tanggal
      );

      // Insert header koreksi
      const keteranganKoreksi = `KOREKSI OTOMATIS DARI TERIMA RETUR ${nomorDokumen}`;
      await connection.query(
        "INSERT INTO tkor_hdr (kor_nomor, kor_tanggal, kor_ket, user_create, date_create) VALUES (?, ?, ?, ?, NOW())",
        [nomorKoreksi, header.tanggal, keteranganKoreksi, user.kode]
      );

      // Insert detail koreksi
      const koreksiValues = selisihItems.map((item) => [
        nomorKoreksi,
        item.kode,
        item.ukuran,
        item.jumlah, // Stok awal sistem adalah jumlah yang seharusnya dikirim
        item.terima, // Jumlah fisik adalah jumlah yang diterima
        item.terima - item.jumlah, // Selisih
        // HPP perlu diambil, untuk sementara kita set 0 jika tidak ada
        0,
        "Selisih Terima Retur",
      ]);
      await connection.query(
        "INSERT INTO tkor_dtl (kord_kor_nomor, kord_kode, kord_ukuran, kord_stok, kord_jumlah, kord_selisih, kord_hpp, kord_ket) VALUES ?",
        [koreksiValues]
      );

      // Update referensi nomor koreksi di header penerimaan
      await connection.query(
        "UPDATE tdcrb_hdr SET rb_koreksi = ? WHERE rb_nomor = ?",
        [nomorKoreksi, nomorDokumen]
      );
    }
    // --- AKHIR LOGIKA KOREKSI OTOMATIS ---

    await connection.commit();
    return {
      message: `Penerimaan Retur berhasil disimpan dengan nomor ${nomorDokumen}`,
      nomor: nomorDokumen,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// ... (Fungsi getForEdit juga perlu dibuat untuk mode Ubah)

module.exports = { loadFromKirim, save };
