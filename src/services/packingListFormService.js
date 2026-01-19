const pool = require("../config/database");

/**
 * Generate Nomor Packing List Baru
 */
const generateNewPlNumber = async (gudang, tanggal) => {
  const [year, month] = tanggal.split("-");
  const prefix = `${gudang}.PL.${year.substring(2)}${month}.`;

  const query = `
    SELECT IFNULL(MAX(RIGHT(pl_nomor, 4)), 0) + 1 AS next_num
    FROM tpacking_list_hdr 
    WHERE pl_nomor LIKE ?;
  `;
  const [rows] = await pool.query(query, [`${prefix}%`]);
  const nextNumber = rows[0].next_num.toString().padStart(4, "0");

  return `${prefix}${nextNumber}`;
};

/**
 * Simpan Data (Insert / Update)
 */
const saveData = async (payload, user) => {
  const { header, items, isNew } = payload;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    if (!header.store?.kode) throw new Error("Store tujuan harus diisi.");
    if (items.length === 0) throw new Error("Detail barang harus diisi.");

    let plNomor = header.nomor;

    // 1. Handle Header
    if (isNew) {
      plNomor = await generateNewPlNumber("KDC", header.tanggal);
      const insertSql = `
        INSERT INTO tpacking_list_hdr 
        (pl_nomor, pl_tanggal, pl_cab_tujuan, pl_mt_nomor, pl_ket, pl_status, user_create, date_create)
        VALUES (?, ?, ?, ?, ?, 'O', ?, NOW())
      `;
      await connection.query(insertSql, [
        plNomor,
        header.tanggal,
        header.store.kode,
        header.permintaan || null,
        header.keterangan,
        user.kode,
      ]);
    } else {
      const [cek] = await connection.query(
        "SELECT pl_status FROM tpacking_list_hdr WHERE pl_nomor = ?",
        [plNomor]
      );
      if (cek.length > 0 && cek[0].pl_status === "C") {
        throw new Error(
          "Packing List sudah Closed/Jadi SJ. Tidak bisa diedit."
        );
      }

      const updateSql = `
        UPDATE tpacking_list_hdr 
        SET pl_tanggal = ?, pl_cab_tujuan = ?, pl_ket = ?, user_modified = ?, date_modified = NOW()
        WHERE pl_nomor = ?
      `;
      await connection.query(updateSql, [
        header.tanggal,
        header.store.kode,
        header.keterangan,
        user.kode,
        plNomor,
      ]);
    }

    // 2. Handle Detail
    await connection.query(
      "DELETE FROM tpacking_list_dtl WHERE pld_nomor = ?",
      [plNomor]
    );

    if (items.length > 0) {
      const detailValues = items
        .filter((item) => item.kode && item.jumlah > 0)
        .map((item) => [
          plNomor,
          item.kode,
          item.ukuran,
          item.jumlah,
          item.keterangan || "",
        ]);

      if (detailValues.length > 0) {
        await connection.query(
          "INSERT INTO tpacking_list_dtl (pld_nomor, pld_kode, pld_ukuran, pld_jumlah, pld_keterangan) VALUES ?",
          [detailValues]
        );
      }
    }

    // --- [TAMBAHAN] 3. Update Status Minta Barang Menjadi Close ---
    // 3. Update Status Minta Barang Menjadi Close agar tidak muncul lagi di pencarian
    if (header.permintaan) {
      const closeMintaSql = `
        UPDATE tmintabarang_hdr 
        SET mt_close = 'Y', 
            user_modified = ?, 
            date_modified = NOW() 
        WHERE mt_nomor = ?
      `;
      await connection.query(closeMintaSql, [user.kode, header.permintaan]);
    }

    await connection.commit();
    return {
      message: `Packing List ${plNomor} berhasil disimpan.`,
      nomor: plNomor,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Load Data Lengkap untuk Mode Edit
 */
const loadForEdit = async (nomor) => {
  const headerQuery = `
    SELECT 
      h.pl_nomor AS nomor,
      h.pl_tanggal AS tanggal,
      h.pl_cab_tujuan AS store_kode,
      g.gdg_nama AS store_nama,
      h.pl_mt_nomor AS permintaan,
      h.pl_ket AS keterangan,
      h.pl_status AS status
    FROM tpacking_list_hdr h
    LEFT JOIN tgudang g ON g.gdg_kode = h.pl_cab_tujuan
    WHERE h.pl_nomor = ?
  `;
  const [headers] = await pool.query(headerQuery, [nomor]);
  if (headers.length === 0) throw new Error("Data tidak ditemukan.");

  const itemsQuery = `
    SELECT 
      d.pld_kode AS kode,
      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
      d.pld_ukuran AS ukuran,
      d.pld_jumlah AS jumlah,
      d.pld_keterangan AS keterangan,
      b.brgd_barcode AS barcode,
      IFNULL((
         SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m 
         WHERE m.mst_aktif='Y' AND m.mst_cab='KDC' 
           AND m.mst_brg_kode=d.pld_kode AND m.mst_ukuran=d.pld_ukuran
      ), 0) AS stok
    FROM tpacking_list_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.pld_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.pld_kode AND b.brgd_ukuran = d.pld_ukuran
    WHERE d.pld_nomor = ?
    ORDER BY d.pld_kode, d.pld_ukuran
  `;
  const [items] = await pool.query(itemsQuery, [nomor]);

  return { header: headers[0], items };
};

/**
 * Load Items dari Tabel Minta Barang
 */
const loadItemsFromRequest = async (nomorMinta) => {

  // Query ini mengambil detail dari tmintabarang_dtl
  // Dan menghitung stok di gudang KDC (Pusat)
  const query = `
    SELECT 
      d.mtd_kode AS kode,
      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
      d.mtd_ukuran AS ukuran,
      d.mtd_jumlah AS minta,
      b.brgd_barcode AS barcode,
      
      -- Stok DC (KDC) saat ini
      IFNULL((
         SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
         FROM tmasterstok m 
         WHERE m.mst_aktif='Y' 
           AND m.mst_cab='KDC'  -- Hardcode KDC karena ini modul DC
           AND m.mst_brg_kode=d.mtd_kode 
           AND m.mst_ukuran=d.mtd_ukuran
      ), 0) AS stok

    FROM tmintabarang_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.mtd_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.mtd_kode AND b.brgd_ukuran = d.mtd_ukuran
    WHERE d.mtd_nomor = ?
    ORDER BY d.mtd_kode, d.mtd_ukuran -- Urutkan biar rapi
  `;

  const [rows] = await pool.query(query, [nomorMinta]);

  // Jika rows kosong, kemungkinan nomor salah atau detail memang tidak ada
  if (rows.length === 0) {
    // Cek apakah header ada? (Opsional untuk debug)
    const [cekHeader] = await pool.query(
      "SELECT mt_nomor FROM tmintabarang_hdr WHERE mt_nomor = ?",
      [nomorMinta]
    );
    if (cekHeader.length === 0) {
      console.warn(
        `[WARNING] Header permintaan ${nomorMinta} tidak ditemukan.`
      );
    } else {
      console.warn(`[WARNING] Header ada tapi detail kosong.`);
    }
  }

  return rows;
};

/**
 * Helper Scan Barcode
 */
const findByBarcode = async (barcode) => {
  const query = `
    SELECT 
      d.brgd_kode AS kode,
      TRIM(CONCAT(h.brg_jeniskaos, " ", h.brg_tipe, " ", h.brg_lengan, " ", h.brg_jeniskain, " ", h.brg_warna)) AS nama,
      d.brgd_ukuran AS ukuran,
      d.brgd_barcode AS barcode,
      IFNULL((
         SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m 
         WHERE m.mst_aktif='Y' AND m.mst_cab='KDC' 
           AND m.mst_brg_kode=d.brgd_kode AND m.mst_ukuran=d.brgd_ukuran
      ), 0) AS stok
    FROM tbarangdc_dtl d
    LEFT JOIN tbarangdc h ON h.brg_kode = d.brgd_kode
    WHERE h.brg_aktif = 0 AND d.brgd_barcode = ?
  `;
  const [rows] = await pool.query(query, [barcode]);
  if (rows.length === 0) throw new Error("Barcode tidak ditemukan.");
  return rows[0];
};

const getPrintData = async (nomor) => {
  // 1. Header Query (Join dengan Gudang Asal untuk Kop Surat & Gudang Tujuan)
  const headerQuery = `
    SELECT 
      h.pl_nomor,
      h.pl_tanggal,
      h.pl_mt_nomor,
      h.pl_ket,
      h.user_create,
      h.date_create,
      
      -- Store Tujuan
      CONCAT(h.pl_cab_tujuan, ' - ', g_dest.gdg_nama) AS store,
      
      -- Info Perusahaan Pengirim (Biasanya DC / KDC)
      -- Kita ambil dari data gudang 'KDC' atau ambil dari prefix nomor PL
      -- Asumsi KDC adalah pengirim
      g_src.gdg_inv_nama AS perush_nama,
      g_src.gdg_inv_alamat AS perush_alamat,
      g_src.gdg_inv_telp AS perush_telp

    FROM tpacking_list_hdr h
    LEFT JOIN tgudang g_dest ON g_dest.gdg_kode = h.pl_cab_tujuan
    LEFT JOIN tgudang g_src ON g_src.gdg_kode = 'KDC' -- Default KDC
    WHERE h.pl_nomor = ?
  `;
  const [headers] = await pool.query(headerQuery, [nomor]);
  if (headers.length === 0)
    throw new Error("Data Packing List tidak ditemukan.");

  // 2. Detail Query
  const detailQuery = `
    SELECT 
      d.pld_kode AS kode,
      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama_barang,
      d.pld_ukuran AS ukuran,
      d.pld_jumlah AS jumlah,
      d.pld_keterangan AS keterangan
    FROM tpacking_list_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.pld_kode
    WHERE d.pld_nomor = ?
    ORDER BY d.pld_kode, d.pld_ukuran
  `;
  const [details] = await pool.query(detailQuery, [nomor]);

  return {
    header: headers[0],
    details: details,
  };
};

module.exports = {
  saveData,
  loadForEdit,
  loadItemsFromRequest,
  findByBarcode,
  getPrintData,
};
