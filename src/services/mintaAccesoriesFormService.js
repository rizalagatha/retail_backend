const pool = require("../config/database");
const { format } = require("date-fns");

// --- HELPER: GENERATE NOMOR ---
const generateNomor = async (connection, jenis, tanggal) => {
  const year = format(new Date(tanggal), "yyyy");
  // Tentukan prefix berdasarkan jenis
  const prefix = jenis === "OBAT" ? `MIO${year}.` : `MIA${year}.`;

  const query = `
    SELECT IFNULL(MAX(CAST(RIGHT(min_nomor, 5) AS UNSIGNED)), 0) + 1 AS next_num
    FROM kencanaprint.tgarmenminta_hdr 
    WHERE min_nomor LIKE ?;
  `;
  const [rows] = await connection.query(query, [`${prefix}%`]);
  const nextNumber = rows[0].next_num.toString().padStart(5, "0");

  return `${prefix}${nextNumber}`;
};

// --- CARI BARANG KAOSAN (F1) ---
const searchBarangKaosan = async (keyword, jenis, cabang = "P03") => {
  const searchTerm = `%${keyword || ""}%`;

  // Filter kategori dan tentukan tabel stok berdasarkan jenis
  let ktgFilter = "";
  let stockTable = "kencanaprint.tmasterstok_acc"; // Default

  if (jenis === "ACCESORIES") {
    ktgFilter = `AND b.brg_ktg = 'STORE'`;
    stockTable = "kencanaprint.tmasterstok_acc";
  } else if (jenis === "OBAT") {
    ktgFilter = `AND b.brg_ktg = 'DTF'`;
    stockTable = "kencanaprint.tmasterstok_obat";
  }

  const query = `
    SELECT 
      b.brg_kode AS kode, 
      b.brg_nama AS nama, 
      b.brg_satuan AS satuan, 
      b.brg_note AS note,
      IFNULL((
        SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
        FROM ${stockTable} m 
        WHERE m.mst_aktif = 'Y' 
          AND m.mst_cab = ? 
          AND m.mst_brg_kode = b.brg_kode
      ), 0) AS stok
    FROM kencanaprint.tgarmen_brg b
    WHERE b.brg_aktif = 'Y' 
      AND b.brg_jenis = ?
      ${ktgFilter}
      AND (b.brg_kode LIKE ? OR b.brg_nama LIKE ?)
    ORDER BY b.brg_nama ASC
  `;

  // Jangan lupa parameter cabang dimasukkan di urutan pertama array
  const [rows] = await pool.query(query, [
    cabang,
    jenis,
    searchTerm,
    searchTerm,
  ]);
  return rows;
};

// --- LOAD DATA (UNTUK MODE EDIT & PRINT) ---
const loadData = async (nomor) => {
  // Ambil Header
  const headerQuery = `
    SELECT 
      min_nomor AS nomor,
      min_tanggal AS tanggal,
      min_cab AS cabang,
      min_jenis AS jenis,
      min_ket AS keterangan,
      user_create
    FROM kencanaprint.tgarmenminta_hdr
    WHERE min_nomor = ?
  `;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0)
    throw new Error("Data permintaan tidak ditemukan.");

  // Ambil Details
  const detailQuery = `
    SELECT 
      d.mind_brg_kode AS kode,
      b.brg_nama AS nama,
      b.brg_satuan AS satuan,
      d.mind_jumlah AS jumlah,
      d.mind_ket AS keterangan
    FROM kencanaprint.tgarmenminta_dtl d
    LEFT JOIN kencanaprint.tgarmen_brg b ON b.brg_kode = d.mind_brg_kode
    WHERE d.mind_nomor = ?
    ORDER BY d.mind_urut ASC
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

    // Terkunci di P03
    const cabang = "P03";
    const jenis = header.jenis || "ACCESORIES";
    const bagianUser = user.bagian ? user.bagian.toUpperCase() : "";

    let nomorPermintaan = header.nomor;

    if (isNew) {
      nomorPermintaan = await generateNomor(connection, jenis, header.tanggal);

      const insertHeaderSql = `
        INSERT INTO kencanaprint.tgarmenminta_hdr 
        (min_jenis, min_nomor, min_tanggal, min_cab, min_bagian, min_ket, date_create, user_create, min_close) 
        VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, 0)
      `;
      await connection.query(insertHeaderSql, [
        jenis,
        nomorPermintaan,
        header.tanggal,
        cabang,
        bagianUser,
        header.keterangan || "",
        user.kode,
      ]);
    } else {
      // Validasi sebelum Edit
      const [cekRows] = await connection.query(
        `SELECT min_close FROM kencanaprint.tgarmenminta_hdr WHERE min_nomor = ?`,
        [nomorPermintaan],
      );
      if (cekRows.length === 0) throw new Error("Data tidak ditemukan.");
      if (cekRows[0].min_close !== 0)
        throw new Error("Data sudah diproses/diclose, tidak bisa diubah.");

      const updateHeaderSql = `
        UPDATE kencanaprint.tgarmenminta_hdr SET 
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
        `DELETE FROM kencanaprint.tgarmenminta_dtl WHERE mind_nomor = ?`,
        [nomorPermintaan],
      );
    }

    // Insert Detail Items
    const validItems = items.filter((item) => item.kode && item.jumlah > 0);
    if (validItems.length > 0) {
      const insertDetailSql = `
        INSERT INTO kencanaprint.tgarmenminta_dtl 
        (mind_nomor, mind_brg_kode, mind_jumlah, mind_pcs, mind_pemakaian, mind_ket, mind_urut) 
        VALUES ?
      `;

      let noUrut = 1;
      const detailValues = validItems.map((item) => [
        nomorPermintaan,
        item.kode,
        parseFloat(item.jumlah).toFixed(2), // Pastikan format decimal
        0,
        0,
        item.keterangan || "",
        noUrut++,
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
