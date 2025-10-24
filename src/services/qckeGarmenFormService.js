const pool = require("../config/database");
const { format } = require("date-fns");

// Helper: getmaxnomor
const generateNewNomor = async (connection, date) => {
  const prefix = `KDC.QC.${format(new Date(date), "yyMM")}.`;
  const [rows] = await connection.query(
    "SELECT IFNULL(MAX(RIGHT(mut_nomor, 4)), 0) as max_nomor FROM tdc_qc_hdr WHERE LEFT(mut_nomor, 11) = ?",
    [prefix]
  );
  const nextNum = parseInt(rows[0].max_nomor, 10) + 1;
  return `${prefix}${String(nextNum).padStart(4, "0")}`;
};

// Helper: getmutnomor (untuk nomor mutasi di detail 2)
const generateNewMutasiNomor = async (connection, date) => {
  const prefix = `KDC.MUT.${format(new Date(date), "yyMM")}`;
  const [rows] = await connection.query(
    "SELECT IFNULL(MAX(RIGHT(mutd_mutasi, 5)), 0) as max_nomor FROM tdc_qc_dtl2 WHERE LEFT(mutd_mutasi, 12) = ?",
    [prefix]
  );
  return parseInt(rows[0].max_nomor, 10);
};

// Mengambil data untuk mode Ubah (loaddataall)
const getDataForEdit = async (nomor) => {
  const [hdr] = await pool.query(
    "SELECT h.*, g.gdg_nama FROM tdc_qc_hdr h LEFT JOIN kencanaprint.tgudang g ON g.gdg_kode = h.mut_kecab WHERE h.mut_nomor = ?",
    [nomor]
  );
  if (hdr.length === 0) throw new Error("Nomor tidak ditemukan.");

  // Ambil detail 1 (Kirim)
  const [dtl1] = await pool.query(
    `SELECT 
            d.mutd_kode AS kode, b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
            d.mutd_ukuran AS ukuran,
            IFNULL((SELECT SUM(m.mst_stok_in-m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif="Y" AND m.mst_cab="KDC" AND m.mst_brg_kode=d.mutd_kode AND m.mst_ukuran=d.mutd_ukuran),0) AS stok,
            d.mutd_jumlah AS jumlah,
            IFNULL((SELECT SUM(i.mutd_jumlah) FROM tdc_qc_dtl2 i WHERE i.mutd_nomor=d.mutd_nomor AND i.mutd_kodelama=d.mutd_kode AND i.mutd_ukuranlama=d.mutd_ukuran),0) AS sudah,
            h.mut_closing AS closing
         FROM tdc_qc_dtl d
         JOIN tdc_qc_hdr h ON d.mutd_nomor = h.mut_nomor
         LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.mutd_kode
         LEFT JOIN retail.tbarangdc_dtl b ON b.brgd_kode = d.mutd_kode AND b.brgd_ukuran = d.mutd_ukuran
         WHERE d.mutd_nomor = ?`,
    [nomor]
  );

  // Ambil detail 2 (Terima)
  const [dtl2] = await pool.query(
    `SELECT 
            d.mutd_kode AS kode, d.mutd_kodelama AS kodelama, d.mutd_ukuranlama AS ukuranlama,
            d.mutd_ukuran AS ukuran, d.mutd_jumlah AS jumlah, d.mutd_mutasi AS mutasi, 
            DATE_FORMAT(d.mutd_tanggal, '%Y-%m-%d') AS tanggal, d.mutd_resize AS resize, d.mutd_closing AS closing,
            b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama
         FROM tdc_qc_dtl2 d
         LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.mutd_kode
         LEFT JOIN retail.tbarangdc_dtl b ON b.brgd_kode = d.mutd_kode AND b.brgd_ukuran = d.mutd_ukuran
         WHERE d.mutd_nomor = ? ORDER BY d.mutd_mutasi`,
    [nomor]
  );

  const header = {
    ...hdr[0],
    tanggal: format(new Date(hdr[0].mut_tanggal), "yyyy-MM-dd"),
  };

  // Hitung 'belum' untuk detail 1
  const items1 = dtl1.map((item) => ({
    ...item,
    id: Math.random(),
    stok: item.stok + item.jumlah, // Stok saat itu = stok sekarang + yg sudah dikirim
    belum: item.jumlah - item.sudah,
  }));

  const items2 = dtl2.map((item) => ({ ...item, id: Math.random() }));

  return { header, items1, items2 };
};

// Menyimpan data (simpandata)
const saveData = async (data, user) => {
  const { header, items1, items2, isEdit } = data;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let qcNomor = header.nomor;
    if (!isEdit) {
      qcNomor = await generateNewNomor(connection, header.tanggal);
    }

    if (isEdit) {
      await connection.query(
        "UPDATE tdc_qc_hdr SET mut_tanggal = ?, mut_kecab = ?, mut_ket = ?, user_modified = ?, date_modified = NOW() WHERE mut_nomor = ?",
        [header.tanggal, header.gudang, header.keterangan, user.kode, qcNomor]
      );
    } else {
      await connection.query(
        "INSERT INTO tdc_qc_hdr (mut_nomor, mut_tanggal, mut_kecab, mut_ket, user_create, date_create) VALUES (?, ?, ?, ?, ?, NOW())",
        [qcNomor, header.tanggal, header.gudang, header.keterangan, user.kode]
      );
    }

    // --- Proses Grid 1 (Kirim) ---
    // Hanya hapus dan insert ulang jika belum closing
    if (header.closing !== "Y") {
      await connection.query("DELETE FROM tdc_qc_dtl WHERE mutd_nomor = ?", [
        qcNomor,
      ]);
      for (const [index, item] of items1.entries()) {
        if (item.kode && (item.jumlah || 0) > 0) {
          await connection.query(
            "INSERT INTO tdc_qc_dtl (mutd_iddrec, mutd_nomor, mutd_kode, mutd_ukuran, mutd_jumlah) VALUES (?, ?, ?, ?, ?)",
            [
              `${qcNomor}${index + 1}`,
              qcNomor,
              item.kode,
              item.ukuran,
              item.jumlah,
            ]
          );
        }
      }
    }

    // --- Proses Grid 2 (Terima) ---
    // Hapus item yg belum closing saja
    await connection.query(
      'DELETE FROM tdc_qc_dtl2 WHERE mutd_closing="N" AND mutd_nomor = ?',
      [qcNomor]
    );

    let nn = await generateNewMutasiNomor(connection, header.tanggal);

    for (const item of items2) {
      if (item.closing !== "Y" && item.kode && (item.jumlah || 0) > 0) {
        let cmut = item.mutasi;
        if (!cmut) {
          nn++;
          cmut = `KDC.MUT.${format(new Date(header.tanggal), "yyMM")}${String(
            nn
          ).padStart(5, "0")}`;
        }
        await connection.query(
          `INSERT INTO tdc_qc_dtl2 (mutd_nomor, mutd_kode, mutd_ukuran, mutd_tanggal, mutd_jumlah, mutd_mutasi, mutd_kodelama, mutd_ukuranlama, mutd_resize) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            qcNomor,
            item.kode,
            item.ukuran,
            item.tanggal,
            item.jumlah,
            cmut,
            item.kodelama,
            item.ukuranlama,
            item.resize,
          ]
        );
      }
    }

    await connection.commit();
    return { message: `QC ${qcNomor} berhasil disimpan.`, nomor: qcNomor };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// Mengambil info gudang (F1)
const getGudangOptions = async () => {
  const [rows] = await pool.query(
    'SELECT gdg_kode AS kode, gdg_nama AS nama FROM kencanaprint.tgudang WHERE gdg_kode IN ("GJ001", "GJ002")'
  );
  return rows;
};

// FUNGSI 1: Untuk F1 (Grid 1 & Grid 2) - Mengambil SEMUA barang
// Menerjemahkan TfrmQC.cxGrdMasterEditKeyDown
const getBarangLookup = async (cabang) => {
  const query = `
        SELECT 
            b.brgd_barcode AS barcode, 
            b.brgd_kode AS kode,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                FROM tmasterstok m
                WHERE m.mst_aktif="Y" AND m.mst_cab = ? 
                  AND m.mst_brg_kode = b.brgd_kode AND m.mst_ukuran = b.brgd_ukuran
            ), 0) AS stok
        FROM retail.tbarangdc_dtl b
        INNER JOIN retail.tbarangdc a ON a.brg_kode = b.brgd_kode
        LEFT JOIN retail.tukuran u ON u.ukuran = b.brgd_ukuran AND u.kategori = ""
        WHERE a.brg_aktif = 0 AND a.brg_logstok = "Y"
        ORDER BY a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna, u.kode
    `;
  const [rows] = await pool.query(query, [cabang]);
  return rows;
};

// FUNGSI 2: Untuk F2 (Grid 2) - Mengambil VARIAN barang dari Grid 1
// Menerjemahkan TfrmQC.cxGrdMaster2EditKeyDown (F2)
const getVarianBarang = async (kodeBarang, cabang) => {
  const query = `
        SELECT 
            b.brgd_barcode AS barcode, b.brgd_kode AS kode,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                FROM tmasterstok m
                WHERE m.mst_aktif="Y" AND m.mst_cab = ? 
                  AND m.mst_brg_kode = b.brgd_kode AND m.mst_ukuran = b.brgd_ukuran
            ), 0) AS stok
        FROM retail.tbarangdc_dtl b
        INNER JOIN retail.tbarangdc a ON a.brg_kode = b.brgd_kode
        LEFT JOIN retail.tukuran u ON u.ukuran = b.brgd_ukuran AND u.kategori = ""
        WHERE a.brg_aktif = 0 AND a.brg_logstok = "Y" AND a.brg_kode = ?
        ORDER BY a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna, u.kode
    `;
  const [rows] = await pool.query(query, [cabang, kodeBarang]);
  return rows;
};

// FUNGSI 3: Untuk ENTER (Grid 1) - Mengambil barang & STOK KDC
// Menerjemahkan TfrmQC.loadbrg
const getProductByBarcodeGrid1 = async (barcode) => {
  const query = `
        SELECT 
            b.brgd_kode AS kode, b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran,
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                FROM retail.tmasterstok m 
                WHERE m.mst_aktif = "Y" AND m.mst_cab = "KDC" -- Stok KDC Sesuai Delphi
                  AND m.mst_brg_kode = b.brgd_kode AND m.mst_ukuran = b.brgd_ukuran
            ), 0) AS stok
        FROM retail.tbarangdc_dtl b
        INNER JOIN retail.tbarangdc a ON a.brg_kode = b.brgd_kode
        WHERE a.brg_aktif = 0 AND b.brgd_barcode = ?
    `;
  const [rows] = await pool.query(query, [barcode]);
  if (rows.length === 0) throw new Error("Barcode tsb tidak ada.");
  return rows[0];
};

// FUNGSI 4: Untuk ENTER (Grid 2) - Hanya mengambil info barang
// Menerjemahkan TfrmQC.loadbrg2
const getProductByBarcodeGrid2 = async (barcode) => {
  const query = `
        SELECT 
            b.brgd_kode AS kode, b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
            b.brgd_ukuran AS ukuran
        FROM retail.tbarangdc_dtl b
        INNER JOIN retail.tbarangdc a ON a.brg_kode = b.brgd_kode
        WHERE a.brg_aktif = 0 AND b.brgd_barcode = ?
    `;
  const [rows] = await pool.query(query, [barcode]);
  if (rows.length === 0) throw new Error("Barcode tsb tidak ada.");
  return rows[0];
};

/**
 * Mengambil data untuk cetak QC ke Garmen.
 * Menerjemahkan query dari TfrmQC.cetak
 */
const getPrintData = async (nomor) => {
  // Query ini mengambil data utama dari TfrmQC.cetak
  const query = `
        SELECT 
            h.mut_nomor, h.mut_tanggal, h.mut_kecab, g.gdg_nama, h.mut_ket,
            d.mutd_kode AS kode,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS Nama,
            d.mutd_ukuran AS ukuran,
            d.mutd_jumlah AS jumlah,
            p.perush_nama, p.perush_alamat, p.perush_telp
        FROM tdc_qc_hdr h
        LEFT JOIN tdc_qc_dtl d ON d.mutd_nomor = h.mut_nomor
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.mutd_kode
        LEFT JOIN kencanaprint.tgudang g ON g.gdg_kode = h.mut_kecab
        CROSS JOIN tperusahaan p
        WHERE h.mut_nomor = ?
    `;

  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) {
    throw new Error("Data cetak tidak ditemukan.");
  }

  // Pisahkan header (data pertama)
  const header = {
    mut_nomor: rows[0].mut_nomor,
    mut_tanggal: rows[0].mut_tanggal,
    mut_kecab: rows[0].mut_kecab,
    gdg_nama: rows[0].gdg_nama,
    mut_ket: rows[0].mut_ket,
    perush_nama: rows[0].perush_nama,
    perush_alamat: rows[0].perush_alamat,
    perush_telp: rows[0].perush_telp,
  };

  // Pisahkan detail (semua baris)
  const details = rows
    .filter((row) => row.kode) // Filter baris yang punya data detail
    .map((row) => ({
      kode: row.kode,
      Nama: row.Nama,
      ukuran: row.ukuran,
      jumlah: row.jumlah,
    }));

  // Logika Delphi: Tambahkan baris kosong hingga 15 baris
  const paddingNeeded = 15 - details.length;
  if (paddingNeeded > 0) {
    for (let i = 0; i < paddingNeeded; i++) {
      details.push({ kode: "", Nama: "", ukuran: "", jumlah: null });
    }
  }

  return { header, details };
};

module.exports = {
  getDataForEdit,
  saveData,
  getGudangOptions,
  getBarangLookup,
  getVarianBarang,
  getProductByBarcodeGrid1,
  getProductByBarcodeGrid2,
  getPrintData,
};
