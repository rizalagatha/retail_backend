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
 * [REVISI V3] Proses Transfer Stok Opname.
 * Sistem BARU: Jurnal Penyesuaian + Recalculate Cut-Off Date + Injeksi Stok Awal SOP
 */
const transferSop = async (nomor, pin, user) => {
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

    const tanggalSop = doc.tanggal_str; // e.g. 2026-04-21
    const cabang = doc.cabang;

    // 2. Ambil data detail dari tabel temporary
    const [details] = await connection.query(
      "SELECT * FROM tsop_dtl2 WHERE sopd_nomor = ?",
      [nomor],
    );

    // =================================================================================
    // 3. RECALCULATE & INJEKSI
    // =================================================================================
    for (const [index, item] of details.entries()) {
      // A. Hitung ulang stok sistem murni HANYA sampai dengan tanggal SOP
      const [stokRows] = await connection.query(
        `SELECT SUM(mst_stok_in - mst_stok_out) as system_stok 
         FROM tmasterstok 
         WHERE mst_aktif = 'Y' 
           AND mst_cab = ? 
           AND mst_brg_kode = ? 
           AND mst_ukuran = ? 
           AND DATE(mst_tanggal) <= ?`,
        [cabang, item.sopd_kode, item.sopd_ukuran, tanggalSop],
      );

      const trueSystemStock = Number(stokRows[0].system_stok || 0);
      const physicalStock = Number(item.sopd_jumlah);
      const trueSelisih = physicalStock - trueSystemStock;

      // B. Update nilai di tabel tsop_dtl2
      await connection.query(
        `UPDATE tsop_dtl2 
         SET sopd_stok = ?, sopd_selisih = ? 
         WHERE sopd_nomor = ? AND sopd_kode = ? AND sopd_ukuran = ?`,
        [trueSystemStock, trueSelisih, nomor, item.sopd_kode, item.sopd_ukuran],
      );

      const now = new Date();
      const baseTime = now.getTime() + index * 2;

      // C. INJEKSI STOK AWAL SOP (Untuk Kartu Stok)
      // Selalu disuntikkan terlepas ada selisih atau tidak,
      // agar Laporan Kartu Stok tahu berapa "titik berangkat" nya
      const timestampAwal = format(new Date(baseTime), "yyyyMMddHHmmss.SSS");
      const idrecAwal = `${cabang}SOP${timestampAwal}`;

      await connection.query(
        `
        INSERT INTO tmasterstok 
        (mst_idrec, mst_cab, mst_brg_kode, mst_ukuran, mst_noreferensi, mst_tanggal, mst_stok_in, mst_stok_out, mst_ket, mst_aktif, date_create)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'STOK AWAL (CUT-OFF SOP)', 'Y', NOW())
      `,
        [
          idrecAwal,
          cabang,
          item.sopd_kode,
          item.sopd_ukuran,
          nomor, // Gunakan nomor SOP agar terhubung
          tanggalSop,
          trueSystemStock, // Record jumlah stok sistem
        ],
      );

      // D. INJEKSI JURNAL KOREKSI (Hanya jika ada selisih)
      if (trueSelisih !== 0) {
        const timestampKoreksi = format(
          new Date(baseTime + 1),
          "yyyyMMddHHmmss.SSS",
        );
        const mstIdrecKoreksi = `${cabang}SOK${timestampKoreksi}`;

        const qtyIn = trueSelisih > 0 ? trueSelisih : 0;
        const qtyOut = trueSelisih < 0 ? Math.abs(trueSelisih) : 0;

        await connection.query(
          `
          INSERT INTO tmasterstok 
          (mst_idrec, mst_cab, mst_brg_kode, mst_ukuran, mst_noreferensi, mst_tanggal, mst_stok_in, mst_stok_out, mst_ket, mst_aktif, date_create)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'KOREKSI STOK OPNAME', 'Y', NOW())
        `,
          [
            mstIdrecKoreksi,
            cabang,
            item.sopd_kode,
            item.sopd_ukuran,
            nomor,
            tanggalSop,
            qtyIn,
            qtyOut,
          ],
        );
      }
    }
    // =================================================================================

    // 4. Hapus & Salin dtl2 ke dtl
    await connection.query("DELETE FROM tsop_dtl WHERE sopd_nomor = ?", [
      nomor,
    ]);
    await connection.query(
      "INSERT INTO tsop_dtl SELECT * FROM tsop_dtl2 WHERE sopd_nomor = ?",
      [nomor],
    );

    // 5. Update Status
    await connection.query(
      'UPDATE tsop_hdr SET sop_transfer="Y" WHERE sop_nomor = ?',
      [nomor],
    );
    await connection.query(
      'UPDATE thitungstok SET hs_proses="Y" WHERE hs_proses="N" AND hs_cab = ?',
      [cabang],
    );
    await connection.query(
      "UPDATE tgudang SET gdg_lastSopOld = gdg_last_sop, gdg_last_sop = ? WHERE gdg_kode = ?",
      [tanggalSop, cabang],
    );
    await connection.query(
      'UPDATE tsop_tanggal SET st_transfer="Y" WHERE st_cab = ? AND st_tanggal = ?',
      [cabang, tanggalSop],
    );

    await connection.commit();
    return {
      message: `Transfer Stok Opname untuk nomor ${nomor} berhasil. Stok telah dikoreksi secara presisi.`,
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
