const pool = require("../config/database");
const { format } = require("date-fns");

/**
 * Mengambil daftar header stok opname yang sudah diproses.
 */
const getList = async (filters) => {
  const { startDate, endDate, cabang } = filters;

  // [PERBAIKAN] Gunakan CASE WHEN untuk memilih tabel sumber (dtl vs dtl2)
  const query = `
    SELECT 
      h.sop_nomor AS nomor,
      h.sop_tanggal AS tanggal,
      h.sop_transfer AS transfer,

      -- 1. Hitung Selisih Qty (Tetap)
      CASE 
        WHEN h.sop_transfer = 'Y' THEN (SELECT COALESCE(SUM(d.sopd_selisih), 0) FROM tsop_dtl d WHERE d.sopd_nomor = h.sop_nomor)
        ELSE (SELECT COALESCE(SUM(d2.sopd_selisih), 0) FROM tsop_dtl2 d2 WHERE d2.sopd_nomor = h.sop_nomor)
      END AS selisih_qty,

      -- 2. Hitung Value Sistem (WAJIB CASE WHEN)
      CASE 
        WHEN h.sop_transfer = 'Y' THEN (SELECT COALESCE(SUM(d.sopd_stok * d.sopd_hpp), 0) FROM tsop_dtl d WHERE d.sopd_nomor = h.sop_nomor)
        ELSE (SELECT COALESCE(SUM(d2.sopd_stok * d2.sopd_hpp), 0) FROM tsop_dtl2 d2 WHERE d2.sopd_nomor = h.sop_nomor)
      END AS value_sistem,

      -- 3. Hitung Value Fisik (WAJIB CASE WHEN)
      CASE 
        WHEN h.sop_transfer = 'Y' THEN (SELECT COALESCE(SUM(d.sopd_jumlah * d.sopd_hpp), 0) FROM tsop_dtl d WHERE d.sopd_nomor = h.sop_nomor)
        ELSE (SELECT COALESCE(SUM(d2.sopd_jumlah * d2.sopd_hpp), 0) FROM tsop_dtl2 d2 WHERE d2.sopd_nomor = h.sop_nomor)
      END AS value_fisik,

      -- 4. Hitung Nominal Selisih (Pastikan sama sumbernya)
      CASE 
        WHEN h.sop_transfer = 'Y' THEN (SELECT COALESCE(SUM(d.sopd_selisih * d.sopd_hpp), 0) FROM tsop_dtl d WHERE d.sopd_nomor = h.sop_nomor)
        ELSE (SELECT COALESCE(SUM(d2.sopd_selisih * d2.sopd_hpp), 0) FROM tsop_dtl2 d2 WHERE d2.sopd_nomor = h.sop_nomor)
      END AS nominal,

      h.sop_ket AS keterangan 
    FROM tsop_hdr h
    WHERE h.sop_tanggal BETWEEN ? AND ?
      AND sop_cab = ?
    ORDER BY h.sop_nomor DESC -- Sebaiknya DESC agar yang terbaru diatas
  `;

  const [rows] = await pool.query(query, [startDate, endDate, cabang]);
  return rows;
};

const validateTransferPin = async (code, pin) => {
  const numericCode = parseFloat(code);
  const numericPin = parseFloat(pin);
  if (isNaN(numericCode) || isNaN(numericPin)) {
    throw new Error("Kode atau PIN harus berupa angka.");
  }
  // Contoh formula, bisa disesuaikan
  const expectedPin = numericCode * 15 + 40 * 2;
  if (numericPin !== expectedPin) {
    throw new Error("Otorisasi salah.");
  }
  return { success: true };
};

/**
 * [REVISI] Proses Transfer Stok Opname.
 * Sistem BARU: Tidak lagi menghapus/men-disable (Sapu Jagat) riwayat stok.
 * Sistem BARU: Menggunakan Jurnal Penyesuaian (Menyuntikkan angka selisih minus/plus ke tmasterstok).
 */
const transferSop = async (nomor, pin, user) => {
  // Di aplikasi web modern, validasi PIN sebaiknya lebih kompleks.
  // Untuk saat ini, kita asumsikan validasi sederhana atau di-bypass.
  // const Z_PIN = 'PIN_RAHASIA_DARI_CONFIG';
  // if (pin !== Z_PIN) throw new Error('PIN Salah.');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Ambil data header untuk validasi
    const [headers] = await connection.query(
      "SELECT sop_nomor, DATE_FORMAT(sop_tanggal, '%Y-%m-%d') AS tanggal_str, sop_transfer, sop_cab as cabang FROM tsop_hdr WHERE sop_nomor = ?",
      [nomor],
    );
    if (headers.length === 0) throw new Error("Dokumen tidak ditemukan.");
    const doc = headers[0];
    if (doc.sop_transfer === "Y")
      throw new Error("Dokumen ini sudah pernah ditransfer.");

    // [KUNCI PERBAIKAN]: Gunakan tanggal_str langsung tanpa new Date()
    const tanggalSop = doc.tanggal_str;
    const cabang = doc.cabang;

    // 2. Ambil data detail (dari tabel temporary dtl2) SEBELUM dipindah ke dtl
    const [details] = await connection.query(
      "SELECT * FROM tsop_dtl2 WHERE sopd_nomor = ?",
      [nomor],
    );

    // =================================================================================
    // 3. [KUNCI REVISI] INJEKSI JURNAL PENYESUAIAN KE tmasterstok
    // =================================================================================
    for (const [index, item] of details.entries()) {
      const selisih = Number(item.sopd_selisih);

      // Hanya proses barang yang memang ada selisihnya
      if (selisih !== 0) {
        // Generate ID unik untuk mutasi koreksi
        const now = new Date();
        const uniqueTime = new Date(now.getTime() + index);
        const timestamp = format(uniqueTime, "yyyyMMddHHmmss.SSS");
        const mstIdrec = `${cabang}SOK${timestamp}`; // Prefix SOK (Stok Opname Koreksi)

        const qtyIn = selisih > 0 ? selisih : 0; // Jika surplus, masuk stok IN
        const qtyOut = selisih < 0 ? Math.abs(selisih) : 0; // Jika minus, masuk stok OUT

        await connection.query(
          `
          INSERT INTO tmasterstok 
          (mst_idrec, mst_cab, mst_brg_kode, mst_ukuran, mst_noreferensi, mst_tanggal, mst_stok_in, mst_stok_out, mst_ket, mst_aktif, date_create)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'KOREKSI STOK OPNAME', 'Y', NOW())
        `,
          [
            mstIdrec,
            cabang,
            item.sopd_kode,
            item.sopd_ukuran,
            nomor, // Referensi ke nomor dokumen SOP
            tanggalSop,
            qtyIn,
            qtyOut,
          ],
        );
      }
    }
    // =================================================================================

    // 4. Hapus data lama di tsop_dtl (jika ada sisa)
    await connection.query("DELETE FROM tsop_dtl WHERE sopd_nomor = ?", [
      nomor,
    ]);

    // 5. Salin data dari tsop_dtl2 ke tsop_dtl
    await connection.query(
      "INSERT INTO tsop_dtl SELECT * FROM tsop_dtl2 WHERE sopd_nomor = ?",
      [nomor],
    );

    // 6. Update status transfer di tsop_hdr
    await connection.query(
      'UPDATE tsop_hdr SET sop_transfer="Y" WHERE sop_nomor = ?',
      [nomor],
    );

    // 7. Update status proses di thitungstok
    await connection.query(
      'UPDATE thitungstok SET hs_proses="Y" WHERE hs_proses="N" AND hs_cab = ?',
      [cabang],
    );

    // 8. Update tanggal SOP terakhir di tgudang
    await connection.query(
      "UPDATE tgudang SET gdg_lastSopOld = gdg_last_sop, gdg_last_sop = ? WHERE gdg_kode = ?",
      [tanggalSop, cabang],
    );

    // 9. Update status transfer di tsop_tanggal
    await connection.query(
      'UPDATE tsop_tanggal SET st_transfer="Y" WHERE st_cab = ? AND st_tanggal = ?',
      [cabang, tanggalSop],
    );

    await connection.commit();
    return {
      message: `Transfer Stok Opname untuk nomor ${nomor} berhasil. Stok telah dikoreksi.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getCabangOptions = async (user) => {
  let query;
  const params = [];
  if (user.cabang === "KDC") {
    query =
      "SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang ORDER BY gdg_kode";
  } else {
    query =
      "SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode = ? ORDER BY gdg_kode";
    params.push(user.cabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil detail item stok opname.
 * [PERBAIKAN] Cek status transfer untuk menentukan tabel sumber (dtl vs dtl2)
 */
const getDetails = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    // 1. Cek status transfer di header dulu
    const [headers] = await connection.query(
      "SELECT sop_transfer FROM tsop_hdr WHERE sop_nomor = ?",
      [nomor],
    );

    if (headers.length === 0) return []; // Header tidak ditemukan

    const isTransferred = headers[0].sop_transfer === "Y";

    // 2. Tentukan tabel sumber berdasarkan status transfer
    // Jika 'Y' (Sudah Transfer) -> pakai tsop_dtl
    // Jika 'N' (Belum Transfer) -> pakai tsop_dtl2
    const tableName = isTransferred ? "tsop_dtl" : "tsop_dtl2";

    const query = `
  SELECT 
    d.sopd_kode AS Kode,
    COALESCE(b.brgd_barcode, '') AS Barcode,
    CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna) AS Nama,
    d.sopd_ukuran AS Ukuran,
    d.sopd_stok AS Stok,
    d.sopd_jumlah AS Jumlah,
    (d.sopd_stok * d.sopd_hpp) AS ValueSistem, -- [BARU]
    (d.sopd_jumlah * d.sopd_hpp) AS ValueFisik, -- [BARU]
    d.sopd_selisih AS Selisih,
    d.sopd_hpp AS Hpp,
    (d.sopd_selisih * d.sopd_hpp) AS Nominal,
    -- PERBAIKAN: Ambil lokasi dari thitungstok jika sopd_ket kosong
    IFNULL(NULLIF(d.sopd_ket, ''), (
      SELECT GROUP_CONCAT(CONCAT(ht.hs_lokasi, "=", ht.hs_qty) SEPARATOR ", ")
      FROM thitungstok ht
      WHERE ht.hs_kode = d.sopd_kode AND ht.hs_ukuran = d.sopd_ukuran 
      AND ht.hs_cab = h.sop_cab AND ht.hs_proses = 'N'
    )) AS Lokasi
  FROM ${tableName} d
  INNER JOIN tsop_hdr h ON h.sop_nomor = d.sopd_nomor -- Pastikan Join ke Header ada
  LEFT JOIN tbarangdc a ON a.brg_kode = d.sopd_kode
  LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sopd_kode AND b.brgd_ukuran = d.sopd_ukuran
  WHERE d.sopd_nomor = ?
  ORDER BY d.sopd_nomor, a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna, d.sopd_ukuran
`;

    const [rows] = await connection.query(query, [nomor]);
    return rows;
  } finally {
    connection.release();
  }
};

/**
 * Mengambil detail item stok opname untuk keperluan export.
 * [PERBAIKAN] Menggunakan UNION untuk mengakomodasi data yang sudah transfer (dtl) dan belum (dtl2)
 */
const getExportDetails = async (filters) => {
  const { startDate, endDate, cabang } = filters;

  const query = `
      SELECT * FROM (
        -- BAGIAN 1: SUDAH TRANSFER (Ambil dari tsop_dtl)
        SELECT 
          d.sopd_nomor AS 'Nomor SOP',
          h.sop_tanggal AS 'Tanggal',
          d.sopd_kode AS 'Kode Barang',
          COALESCE(b.brgd_barcode, '') AS 'Barcode',
          CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna) AS 'Nama Barang',
          d.sopd_ukuran AS 'Ukuran',
          d.sopd_stok AS 'Stok Sistem',
          (d.sopd_stok * d.sopd_hpp) AS 'Value Sistem',
          d.sopd_jumlah AS 'Jumlah Fisik',
          (d.sopd_jumlah * d.sopd_hpp) AS 'Value Fisik',
          d.sopd_selisih AS 'Selisih',
          d.sopd_hpp AS 'HPP',
          (d.sopd_selisih * d.sopd_hpp) AS 'Nominal Selisih',
          d.sopd_ket AS 'Lokasi',
          1 AS urutan_prioritas
        FROM tsop_dtl d
        INNER JOIN tsop_hdr h ON h.sop_nomor = d.sopd_nomor
        LEFT JOIN tbarangdc a ON a.brg_kode = d.sopd_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sopd_kode AND b.brgd_ukuran = d.sopd_ukuran
        WHERE 
            DATE(h.sop_tanggal) BETWEEN ? AND ?
            AND h.sop_cab = ?
            AND h.sop_transfer = 'Y'

        UNION ALL

        -- BAGIAN 2: BELUM TRANSFER (Ambil dari tsop_dtl2)
        SELECT 
          d.sopd_nomor AS 'Nomor SOP',
          h.sop_tanggal AS 'Tanggal',
          d.sopd_kode AS 'Kode Barang',
          COALESCE(b.brgd_barcode, '') AS 'Barcode',
          CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna) AS 'Nama Barang',
          d.sopd_ukuran AS 'Ukuran',
          d.sopd_stok AS 'Stok Sistem',
          (d.sopd_stok * d.sopd_hpp) AS 'Value Sistem', -- [DITAMBAHKAN]
          d.sopd_jumlah AS 'Jumlah Fisik',
          (d.sopd_jumlah * d.sopd_hpp) AS 'Value Fisik',  -- [DITAMBAHKAN]
          d.sopd_selisih AS 'Selisih',
          d.sopd_hpp AS 'HPP',
          (d.sopd_selisih * d.sopd_hpp) AS 'Nominal Selisih',
          (
            SELECT GROUP_CONCAT(CONCAT(ht.hs_lokasi, "=", ht.hs_qty) SEPARATOR ", ")
            FROM thitungstok ht
            WHERE ht.hs_kode = d.sopd_kode AND ht.hs_ukuran = d.sopd_ukuran 
            AND ht.hs_cab = h.sop_cab AND ht.hs_proses = 'N'
          ) AS 'Lokasi',
          2 AS urutan_prioritas
        FROM tsop_dtl2 d
        INNER JOIN tsop_hdr h ON h.sop_nomor = d.sopd_nomor
        LEFT JOIN tbarangdc a ON a.brg_kode = d.sopd_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sopd_kode AND b.brgd_ukuran = d.sopd_ukuran
        WHERE 
            DATE(h.sop_tanggal) BETWEEN ? AND ?
            AND h.sop_cab = ?
            AND (h.sop_transfer = 'N' OR h.sop_transfer = '' OR h.sop_transfer IS NULL)
      ) AS gabungan
      
      ORDER BY 
        gabungan.\`Nomor SOP\`, 
        gabungan.\`Nama Barang\`, 
        gabungan.\`Ukuran\`
    `;

  const params = [startDate, endDate, cabang, startDate, endDate, cabang];
  const [rows] = await pool.query(query, params);

  const cleanRows = rows.map((row) => {
    const { urutan_prioritas, ...rest } = row;
    return rest;
  });

  return cleanRows;
};

module.exports = {
  getList,
  validateTransferPin,
  transferSop,
  getCabangOptions,
  getDetails,
  getExportDetails,
};
