const pool = require("../config/database");
const { format, addMonths, startOfMonth } = require("date-fns");

// Fungsi helper untuk mengambil stok (dari loadbrg dan loaddataall)
const getStok = async (cabang, kode, ukuran) => {
  const query = `
        SELECT IFNULL(SUM(m.mst_stok_in - m.mst_stok_out), 0) AS Stok
        FROM retail.tmasterstok m 
        WHERE m.mst_aktif = "Y" AND m.mst_cab = ? 
          AND m.mst_brg_kode = ? AND m.mst_ukuran = ?
    `;
  const [rows] = await pool.query(query, [cabang, kode, ukuran]);
  return rows[0].Stok;
};

// Fungsi helper untuk mengambil detail produk (dari loadbrg)
const getProductByBarcode = async (barcode, cabang) => {
  const query = `
        SELECT b.brgd_kode AS kode, b.brgd_barcode AS barcode,
               TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
               b.brgd_ukuran AS ukuran
        FROM retail.tbarangdc_dtl b
        INNER JOIN retail.tbarangdc a ON a.brg_kode = b.brgd_kode
        WHERE a.brg_aktif = 0 AND a.brg_logstok = "Y" AND b.brgd_barcode = ?
    `;
  const [rows] = await pool.query(query, [barcode]);
  if (rows.length === 0) throw new Error("Barcode tidak terdaftar.");

  const stok = await getStok(cabang, rows[0].kode, rows[0].ukuran);
  return { ...rows[0], stok };
};

// Fungsi untuk menyimpan data (simpandata)
const saveData = async (payload, user) => {
  const { header, items } = payload;
  const isEdit = !!header.nomor && header.nomor !== "<--Kosong=Baru";
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // --- Validasi Delphi (btnSimpanClick) ---
    if (header.dariGudang === header.keGudang)
      throw new Error("Gudang tidak boleh sama.");
    // TODO: Implementasikan validasi tanggal close (zClose) jika diperlukan
    // ...

    let nomorMutasi = header.nomor;
    if (!isEdit) {
      const aym = format(new Date(header.tanggal), "yyMM");
      const [maxRows] = await connection.query(
        "SELECT IFNULL(MAX(RIGHT(mts_nomor, 5)), 0) as max_nomor FROM retail.tdc_mts_hdr WHERE LEFT(mts_nomor, 12) = ?",
        [`${header.dariGudang}.MTS.${aym}`]
      );
      const nextNum = parseInt(maxRows[0].max_nomor, 10) + 1;
      nomorMutasi = `${header.dariGudang}.MTS.${aym}${String(nextNum).padStart(
        5,
        "0"
      )}`;
    }

    // Simpan Header
    if (isEdit) {
      await connection.query(
        "UPDATE retail.tdc_mts_hdr SET mts_tanggal = ?, mts_kecab = ?, mts_ket = ?, user_modified = ?, date_modified = NOW() WHERE mts_nomor = ?",
        [
          header.tanggal,
          header.keGudang,
          header.keterangan,
          user.kode,
          nomorMutasi,
        ]
      );
    } else {
      await connection.query(
        "INSERT INTO retail.tdc_mts_hdr (mts_nomor, mts_tanggal, mts_kecab, mts_ket, user_create, date_create) VALUES (?, ?, ?, ?, ?, NOW())",
        [
          nomorMutasi,
          header.tanggal,
          header.keGudang,
          header.keterangan,
          user.kode,
        ]
      );
    }

    // Hapus detail lama
    await connection.query(
      "DELETE FROM retail.tdc_mts_dtl WHERE mtsd_nomor = ?",
      [nomorMutasi]
    );

    // Siapkan nomor mutasi IN
    const aym = format(new Date(header.tanggal), "yyMM");
    const [maxInRows] = await connection.query(
      "SELECT IFNULL(MAX(RIGHT(mtsd_nomorin, 5)), 0) as max_nomor FROM retail.tdc_mts_dtl WHERE LEFT(mtsd_nomorin, 12) = ?",
      [`${header.keGudang}.MTS.${aym}`]
    );
    let n = parseInt(maxInRows[0].max_nomor, 10) + 1;

    // Insert detail baru
    for (const [index, item] of items.entries()) {
      if (!item.kode || !item.jumlah) continue;

      // Validasi stok
      const stokAktual = await getStok(
        header.dariGudang,
        item.kode,
        item.ukuran
      );
      if (item.jumlah > stokAktual) {
        throw new Error(
          `Jumlah untuk ${item.nama} (${item.ukuran}) melebihi stok (${stokAktual}).`
        );
      }

      const mutin = `${header.keGudang}.MTS.${aym}${String(n).padStart(
        5,
        "0"
      )}`;
      await connection.query(
        "INSERT INTO retail.tdc_mts_dtl (mtsd_iddrec, mtsd_nomor, mtsd_nomorin, mtsd_kode, mtsd_ukuran, mtsd_jumlah) VALUES (?, ?, ?, ?, ?, ?)",
        [
          `${nomorMutasi}${index + 1}`,
          nomorMutasi,
          mutin,
          item.kode,
          item.ukuran,
          item.jumlah,
        ]
      );
      n++;
    }

    await connection.commit();
    return {
      message: `Mutasi berhasil disimpan dengan Nomor ${nomorMutasi}`,
      nomor: nomorMutasi,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// Fungsi untuk memuat data (loaddataall)
const getDataForEdit = async (nomor, user) => {
  const [headerRows] = await pool.query(
    "SELECT *, LEFT(mts_nomor, 3) as dariGudang FROM retail.tdc_mts_hdr WHERE mts_nomor = ?",
    [nomor]
  );
  if (headerRows.length === 0) throw new Error("Nomor tidak ditemukan.");

  const header = headerRows[0];

  const [detailRows] = await pool.query(
    `SELECT 
            d.mtsd_kode AS kode, d.mtsd_ukuran AS ukuran, d.mtsd_jumlah AS jumlah, b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama
         FROM retail.tdc_mts_dtl d
         LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.mtsd_kode
         LEFT JOIN retail.tbarangdc_dtl b ON b.brgd_kode = d.mtsd_kode AND b.brgd_ukuran = d.mtsd_ukuran
         WHERE d.mtsd_nomor = ?`,
    [nomor]
  );

  // Ambil stok untuk setiap item
  const items = await Promise.all(
    detailRows.map(async (item) => {
      const stok = await getStok(header.dariGudang, item.kode, item.ukuran);
      return {
        ...item,
        stok: stok + item.jumlah, // Stok saat itu = stok sekarang + yg sudah dimutasi
      };
    })
  );

  return { header, items };
};

// Mengambil opsi gudang DC (KBS, KDC, KPS)
const getGudangOptions = async () => {
  const [rows] = await pool.query(
    "SELECT gdg_kode FROM retail.tgudang WHERE gdg_dc = 1"
  );
  return rows.map((r) => r.gdg_kode);
};

/**
 * Mengambil data untuk cetak Mutasi Antar Gudang.
 * Menerjemahkan query dari TfrmMtsAg.cetak
 */
const getPrintData = async (nomor) => {
  // Query ini diambil dari TfrmMtsAg.cetak dan ditambahkan join info perusahaan
  const query = `
        SELECT 
            h.mts_nomor, 
            h.mts_tanggal, 
            LEFT(h.mts_nomor, 3) AS mts_drcab, 
            h.mts_kecab, 
            h.mts_ket,
            d.mtsd_kode, 
            d.mtsd_ukuran, 
            d.mtsd_jumlah,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            
            -- Info Gudang
            g_dari.gdg_nama AS nama_dari_cabang,
            g_ke.gdg_nama AS nama_ke_cabang,
            
            -- Info Perusahaan (diambil dari tperusahaan, atau g_dari jika tperusahaan tidak ada)
            COALESCE(p.perush_nama, g_dari.gdg_inv_nama) AS perush_nama,
            COALESCE(p.perush_alamat, g_dari.gdg_inv_alamat) AS perush_alamat,
            COALESCE(p.perush_kota, g_dari.gdg_inv_kota) AS perush_kota,
            COALESCE(p.perush_telp, g_dari.gdg_inv_telp) AS perush_telp
            
        FROM retail.tdc_mts_hdr h
        -- Menggunakan 'LEFT JOIN retail.tdc_mts_dtl' sesuai query Delphi Anda
        LEFT JOIN retail.tdc_mts_dtl d ON d.mtsd_nomor = h.mts_nomor
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.mtsd_kode
        LEFT JOIN retail.tgudang g_dari ON LEFT(h.mts_nomor, 3) = g_dari.gdg_kode
        LEFT JOIN retail.tgudang g_ke ON h.mts_kecab = g_ke.gdg_kode
        -- Menggunakan CROSS JOIN untuk mengambil data perusahaan (umum di laporan Delphi)
        CROSS JOIN tperusahaan p
        WHERE h.mts_nomor = ?
    `;

  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) {
    throw new Error("Data cetak tidak ditemukan.");
  }

  // Pisahkan header (data pertama)
  const header = {
    mts_nomor: rows[0].mts_nomor,
    mts_tanggal: rows[0].mts_tanggal,
    mts_drcab: rows[0].mts_drcab,
    mts_kecab: rows[0].mts_kecab,
    mts_ket: rows[0].mts_ket,
    nama_dari_cabang: rows[0].nama_dari_cabang,
    nama_ke_cabang: rows[0].nama_ke_cabang,
    perush_nama: rows[0].perush_nama,
    perush_alamat: rows[0].perush_alamat,
    perush_kota: rows[0].perush_kota,
    perush_telp: rows[0].perush_telp,
  };

  // Pisahkan detail (semua baris)
  // Filter untuk memastikan hanya baris dengan kode barang yang valid yang masuk
  const details = rows
    .filter((row) => row.mtsd_kode) // Hanya ambil baris yang punya data detail
    .map((row) => ({
      mtsd_kode: row.mtsd_kode,
      nama: row.nama,
      mtsd_ukuran: row.mtsd_ukuran,
      mtsd_jumlah: row.mtsd_jumlah,
    }));

  return { header, details };
};

module.exports = {
  getProductByBarcode,
  saveData,
  getDataForEdit,
  getGudangOptions,
  getPrintData,
};
