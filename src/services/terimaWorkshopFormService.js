const pool = require("../config/database");

// --- Helper untuk generate IDREC khusus MWT ---
const generateIdRec = (cabang) => {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");

  // Gunakan 'MWT' untuk Mutasi Workshop Terima
  // Format: W01MWT20260430101112.134
  return `${cabang}MWT${yyyy}${mm}${dd}${hh}${min}${ss}.${ms}`;
};

// --- Fungsi untuk memuat data dari dokumen pengiriman Workshop (MWK) ---
const loadFromKirim = async (nomorKirim) => {
  const query = `
    SELECT 
        h.mw_nomor, h.mw_tanggal, h.mw_ket,
        h.mw_cab_asal AS gudangAsalKode,
        g.gdg_nama AS gudangAsalNama,
        d.mwd_kode AS kode,
        b.brgd_barcode AS barcode,
        TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), ' ', IFNULL(a.brg_tipe,''), ' ', IFNULL(a.brg_lengan,''), ' ', IFNULL(a.brg_jeniskain,''), ' ', IFNULL(a.brg_warna,''))) AS nama,
        d.mwd_ukuran AS ukuran,
        d.mwd_jumlah AS jumlahKirim
    FROM tmutasi_workshop_hdr h
    INNER JOIN tmutasi_workshop_dtl d ON d.mwd_nomor = h.mw_nomor
    LEFT JOIN tbarangdc a ON a.brg_kode = d.mwd_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.mwd_kode AND b.brgd_ukuran = d.mwd_ukuran
    LEFT JOIN tgudang g ON g.gdg_kode = h.mw_cab_asal
    WHERE h.mw_nomor = ?;
  `;

  const [rows] = await pool.query(query, [nomorKirim]);
  if (rows.length === 0)
    throw new Error("Dokumen pengiriman workshop tidak ditemukan.");

  const header = {
    nomorKirim: rows[0].mw_nomor,
    tanggalKirim: rows[0].mw_tanggal,
    gudangAsalKode: rows[0].gudangAsalKode,
    gudangAsalNama: rows[0].gudangAsalNama,
    keterangan: rows[0].mw_ket,
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

// --- Fungsi untuk menyimpan data penerimaan Workshop (MWT) ---
const save = async (payload, user) => {
  const { header, items } = payload;

  if (!items || items.length === 0) {
    throw new Error("Tidak dapat menyimpan: Daftar barang kosong!");
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Generate Nomor Transaksi (Contoh: W01.MWT.26.00001)
    const year = new Date(header.tanggalTerima)
      .getFullYear()
      .toString()
      .substring(2);
    const prefix = `${user.cabang}.MWT.${year}`;

    // Cari nomor terakhir di tmwt_hdr
    const nomorQuery = `SELECT IFNULL(MAX(RIGHT(mwt_nomor, 5)), 0) + 1 AS next_num FROM tmwt_hdr WHERE LEFT(mwt_nomor, 10) = ?;`;
    const [nomorRows] = await connection.query(nomorQuery, [prefix]);
    const nextNum = nomorRows[0].next_num.toString().padStart(5, "0");
    const nomorTerima = `${prefix}.${nextNum}`;

    // [PERBAIKAN] Insert Header tmwt_hdr sesuai kolom yang ada di database
    const headerInsertQuery = `
        INSERT INTO tmwt_hdr (
            mwt_nomor, mwt_tanggal, mwt_nokirim,
            mwt_cab, mwt_ket, 
            user_create, date_create
        )
        VALUES (?, ?, ?, ?, ?, ?, NOW());
    `;
    await connection.query(headerInsertQuery, [
      nomorTerima,
      header.tanggalTerima,
      header.nomorKirim, // Wajib diisi sesuai DDL Mas Rizal
      user.cabang,
      header.keterangan || "",
      user.kode,
    ]);

    // Update Status Dokumen Pengiriman (tmutasi_workshop_hdr)
    await connection.query(
      "UPDATE tmutasi_workshop_hdr SET mw_noterima = ? WHERE mw_nomor = ?",
      [nomorTerima, header.nomorKirim],
    );

    // [PERBAIKAN] Insert Detail tmwt_dtl sesuai kolom yang ada
    if (items.length > 0) {
      const itemInsertQuery = `
        INSERT INTO tmwt_dtl (
            mwtd_nomor, mwtd_kode, mwtd_ukuran, mwtd_jumlah
        ) VALUES ?;
      `;

      // Kita biarkan mwtd_nourut terisi otomatis oleh AUTO_INCREMENT
      const itemValues = items.map((item) => {
        return [
          nomorTerima, // Nomor MWT
          item.kode,
          item.ukuran,
          item.jumlahTerima,
        ];
      });

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
