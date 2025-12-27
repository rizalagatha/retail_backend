const pool = require("../config/database");

const getList = async (filters, user) => {
  const { startDate, endDate, itemCode } = filters;

  const query = `
        SELECT 
            h.rb_nomor AS nomor,
            h.rb_tanggal AS tanggal,
            h.rb_noterima AS nomorTerima,
            r.rb_tanggal AS tglTerima,
            LEFT(h.rb_nomor, 3) AS store,
            g.gdg_nama AS namaStore,
            IFNULL(r.rb_koreksi, "") AS noKoreksi,
            h.rb_ket AS keterangan,
            (
                SELECT CASE 
                    WHEN pin_acc = "" AND pin_dipakai = "" THEN "WAIT"
                    WHEN pin_acc = "Y" AND pin_dipakai = "" THEN "ACC"
                    WHEN pin_acc = "Y" AND pin_dipakai = "Y" THEN ""
                    WHEN pin_acc = "N" THEN "TOLAK"
                    ELSE ""
                END
                FROM kencanaprint.tspk_pin5 
                WHERE pin_trs = "TERIMA RB" AND pin_nomor = h.rb_noterima 
                ORDER BY pin_urut DESC LIMIT 1
            ) AS statusPengajuan,
            h.user_create AS usr,
            IFNULL(r.rb_closing, "N") AS closing
        FROM retail.trbdc_hdr h
        LEFT JOIN retail.trbdc_dtl d ON d.rbd_nomor = h.rb_nomor
        LEFT JOIN retail.tgudang g ON g.gdg_kode = LEFT(h.rb_nomor, 3)
        LEFT JOIN tdcrb_hdr r ON r.rb_nomor = h.rb_noterima
        WHERE h.rb_tanggal BETWEEN ? AND ?
        AND (? IS NULL OR d.rbd_kode = ?)
        GROUP BY h.rb_nomor
        ORDER BY h.rb_noterima, h.rb_nomor;
    `;
  const params = [startDate, endDate, itemCode || null, itemCode];
  const [rows] = await pool.query(query, params);
  return rows;
};

const getDetails = async (nomor) => {
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

const cancelReceipt = async (nomorKirim, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Ambil semua data yang relevan dari dokumen pengiriman dan penerimaan
    const [headerRows] = await connection.query(
      `SELECT 
                h.rb_noterima, 
                t.rb_koreksi,
                t.rb_closing,
                t.rb_tanggal AS tglTerima
            FROM trbdc_hdr h
            LEFT JOIN tdcrb_hdr t ON h.rb_noterima = t.rb_nomor
            WHERE h.rb_nomor = ?`,
      [nomorKirim]
    );

    if (headerRows.length === 0)
      throw new Error("Dokumen pengiriman tidak ditemukan.");
    const doc = headerRows[0];

    // --- VALIDASI DARI DELPHI ---
    if (!doc.rb_noterima) {
      throw new Error("Dokumen ini belum pernah diterima.");
    }
    if (doc.rb_closing === "Y") {
      throw new Error("Sudah Closing Stok Opname, tidak bisa dibatalkan.");
    }
    if (doc.rb_koreksi) {
      // Cek apakah koreksi selisih sudah di-ACC
      const [koreksiRows] = await connection.query(
        "SELECT kor_acc FROM tkor_hdr WHERE kor_nomor = ?",
        [doc.rb_koreksi]
      );
      if (koreksiRows.length > 0 && koreksiRows[0].kor_acc) {
        throw new Error(
          "Ada selisih retur yang sudah di-ACC, tidak bisa dibatalkan."
        );
      }
    }
    // (Logika pengecekan tanggal closing yang kompleks dari Delphi bisa ditambahkan di sini jika diperlukan)
    // --- AKHIR VALIDASI ---

    // --- PROSES PEMBATALAN ---
    // 1. Hapus header penerimaan (tdcrb_hdr) dan detailnya (via cascade atau manual)
    await connection.query("DELETE FROM tdcrb_dtl WHERE rbd_nomor = ?", [
      doc.rb_noterima,
    ]);
    await connection.query("DELETE FROM tdcrb_hdr WHERE rb_nomor = ?", [
      doc.rb_noterima,
    ]);

    // 2. Kosongkan referensi di header pengiriman (trbdc_hdr)
    await connection.query(
      'UPDATE trbdc_hdr SET rb_noterima = "" WHERE rb_nomor = ?',
      [nomorKirim]
    );

    await connection.commit();
    return {
      message: `Penerimaan untuk dokumen ${nomorKirim} berhasil dibatalkan.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const submitChangeRequest = async (payload, user) => {
  const { nomorTerima, tanggalTerima, nomorKirim, alasan } = payload;
  const query = `
        INSERT INTO kencanaprint.tspk_pin5 (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan)
        VALUES (
            "TERIMA RB", ?, 
            (SELECT IFNULL(MAX(pin_urut), 0) + 1 FROM kencanaprint.tspk_pin5 WHERE pin_nomor = ?), 
            ?, ?, NOW(), ?, ?
        )
        ON DUPLICATE KEY UPDATE 
            pin_tgl_trs = VALUES(pin_tgl_trs),
            pin_ket = VALUES(pin_ket),
            pin_acc = "",
            pin_tgl_minta = NOW(),
            pin_user_minta = VALUES(pin_user_minta),
            pin_alasan = VALUES(pin_alasan);
    `;
  await pool.query(query, [
    nomorTerima,
    nomorTerima,
    tanggalTerima,
    nomorKirim,
    user.kode,
    alasan,
  ]);
  return { message: "Pengajuan perubahan berhasil dikirim. Menunggu ACC." };
};

const getExportDetails = async (filters, user) => {
  const { startDate, endDate, itemCode } = filters;

  const query = `
    SELECT 
        h.rb_nomor AS 'Nomor Kirim',
        h.rb_tanggal AS 'Tgl Kirim',
        h.rb_noterima AS 'Nomor Terima',
        r.rb_tanggal AS 'Tgl Terima',
        LEFT(h.rb_nomor, 3) AS 'Kode Store',
        g.gdg_nama AS 'Nama Store',
        IFNULL(r.rb_koreksi, "") AS 'No Koreksi',
        h.rb_ket AS 'Keterangan',
        h.user_create AS 'User',
        IFNULL(r.rb_closing, "N") AS 'Closing',
        
        d.rbd_kode AS 'Kode Barang',
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS 'Nama Barang',
        d.rbd_ukuran AS 'Ukuran',
        d.rbd_jumlah AS 'Jumlah Kirim',
        IFNULL(rd.rbd_jumlah, 0) AS 'Jumlah Terima',
        (IFNULL(rd.rbd_jumlah, 0) - d.rbd_jumlah) AS 'Selisih'

    FROM retail.trbdc_hdr h
    INNER JOIN retail.trbdc_dtl d ON d.rbd_nomor = h.rb_nomor
    LEFT JOIN retail.tgudang g ON g.gdg_kode = LEFT(h.rb_nomor, 3)
    LEFT JOIN tdcrb_hdr r ON r.rb_nomor = h.rb_noterima
    LEFT JOIN retail.tdcrb_dtl rd ON rd.rbd_nomor = r.rb_nomor AND rd.rbd_kode = d.rbd_kode AND rd.rbd_ukuran = d.rbd_ukuran
    LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.rbd_kode
    
    WHERE 
        -- [FIX] Gunakan DATE()
        DATE(h.rb_tanggal) BETWEEN ? AND ?
        AND (? IS NULL OR d.rbd_kode = ?)
        
    ORDER BY h.rb_noterima, h.rb_nomor, d.rbd_kode;
  `;

  const params = [startDate, endDate, itemCode || null, itemCode];
  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getDetails,
  cancelReceipt,
  submitChangeRequest,
  getExportDetails,
};
