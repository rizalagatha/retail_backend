const pool = require("../config/database");
const { format } = require("date-fns");

// --- HELPER: GENERATE NOMOR ---
// Format: MIA2026.00001
const generateNomor = async (connection, tanggal) => {
  const year = format(new Date(tanggal), "yyyy");
  const prefix = `MIA${year}.`;

  const query = `
    SELECT IFNULL(MAX(RIGHT(min_nomor, 5)), 0) + 1 AS next_num
    FROM kencanaprint.taccmintabahan_hdr 
    WHERE LEFT(min_nomor, 8) = ?;
  `;
  const [rows] = await connection.query(query, [prefix]);
  const nextNumber = rows[0].next_num.toString().padStart(5, "0");

  return `${prefix}${nextNumber}`;
};

// --- CARI BARANG KAOSAN (F1) ---
const searchBarangKaosan = async (keyword) => {
  const searchTerm = `%${keyword || ""}%`;

  // Filter: Aktif = 'Y' dan Kategori = 'STORE'
  const query = `
    SELECT 
      acc_kode AS kode, 
      acc_nama AS nama, 
      acc_satuan AS satuan, 
      acc_note AS note
    FROM kencanaprint.taccesories
    WHERE acc_aktif = 'Y' 
      AND acc_kategori = 'STORE'
      AND (acc_kode LIKE ? OR acc_nama LIKE ?)
    ORDER BY acc_nama ASC
    LIMIT 100;
  `;

  const [rows] = await pool.query(query, [searchTerm, searchTerm]);
  return rows;
};

// --- LOAD DATA (UNTUK MODE EDIT) ---
const loadData = async (nomor) => {
  // Ambil Header
  const headerQuery = `
    SELECT 
      min_nomor AS nomor,
      min_tanggal AS tanggal,
      min_cab AS cabang,
      min_gp AS gudangProduksiKode,
      min_ket AS keterangan
    FROM kencanaprint.taccmintabahan_hdr
    WHERE min_nomor = ?
  `;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0)
    throw new Error("Data permintaan tidak ditemukan.");

  // Ambil Details
  const detailQuery = `
    SELECT 
      d.mind_acc_kode AS kode,
      b.acc_nama AS nama,
      b.acc_satuan AS satuan,
      d.mind_jumlah AS jumlah,
      d.mind_ket AS keterangan
    FROM kencanaprint.taccmintabahan_dtl d
    LEFT JOIN kencanaprint.taccesories b ON b.acc_kode = d.mind_acc_kode
    WHERE d.mind_nomor = ?
  `;
  const [itemRows] = await pool.query(detailQuery, [nomor]);

  return {
    header: headerRows[0],
    items: itemRows,
  };
};

// --- SIMPAN DATA (CREATE / UPDATE) ---
const saveData = async (payload, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const { header, items, isNew } = payload;

    // Default P03 & Gudang Produksi Kaosan (K0001)
    const cabang = "P03";
    const gudangProduksi = "K0001";
    const spkNomor = ""; // SPK ditiadakan

    let nomorPermintaan = header.nomor;

    if (isNew) {
      nomorPermintaan = await generateNomor(connection, header.tanggal);

      const insertHeaderSql = `
        INSERT INTO kencanaprint.taccmintabahan_hdr 
        (min_nomor, min_tanggal, min_cab, min_gp, min_spk_nomor, min_ket, date_create, user_create) 
        VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)
      `;
      await connection.query(insertHeaderSql, [
        nomorPermintaan,
        header.tanggal,
        cabang,
        gudangProduksi,
        spkNomor,
        header.keterangan || "",
        user.kode,
      ]);
    } else {
      // Validasi sebelum Edit
      const [cekRows] = await connection.query(
        `SELECT min_close FROM kencanaprint.taccmintabahan_hdr WHERE min_nomor = ?`,
        [nomorPermintaan],
      );
      if (cekRows.length === 0) throw new Error("Data tidak ditemukan.");
      if (cekRows[0].min_close !== 0)
        throw new Error("Data sudah diproses/diclose, tidak bisa diubah.");

      const updateHeaderSql = `
        UPDATE kencanaprint.taccmintabahan_hdr SET 
          min_tanggal = ?, 
          min_ket = ?, 
          date_modified = NOW(), 
          user_modified = ? 
        WHERE min_nomor = ?
      `;
      await connection.query(updateHeaderSql, [
        header.tanggal,
        header.keterangan || "",
        user.kode,
        nomorPermintaan,
      ]);

      // Hapus detail lama untuk ditimpa yang baru
      await connection.query(
        `DELETE FROM kencanaprint.taccmintabahan_dtl WHERE mind_nomor = ?`,
        [nomorPermintaan],
      );
    }

    // Insert Detail Items
    const validItems = items.filter((item) => item.kode && item.jumlah > 0);
    if (validItems.length > 0) {
      const insertDetailSql = `
        INSERT INTO kencanaprint.taccmintabahan_dtl 
        (mind_nomor, mind_acc_kode, mind_jumlah, mind_pcs, mind_pemakaian, mind_ket) 
        VALUES ?
      `;

      const detailValues = validItems.map((item) => [
        nomorPermintaan,
        item.kode,
        item.jumlah,
        0, // mind_pcs default 0 (karena SPK dihilangkan)
        0, // mind_pemakaian default 0
        item.keterangan || "",
      ]);

      await connection.query(insertDetailSql, [detailValues]);
    } else {
      throw new Error("Detail barang tidak boleh kosong atau jumlah = 0.");
    }

    await connection.commit();
    return {
      message: `Permintaan ${nomorPermintaan} berhasil disimpan.`,
      nomor: nomorPermintaan,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  searchBarangKaosan,
  loadData,
  saveData,
};
