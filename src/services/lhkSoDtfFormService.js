const pool = require("../config/database");

const loadData = async (tanggal, cabang) => {
  const query = `
        SELECT 
            d.spk_nomor AS kode,
            h.sd_nama AS nama,
            d.depan,
            d.belakang,
            d.lengan,
            d.variasi,
            d.saku,
            d.panjang,
            d.buangan,
            d.keterangan AS ket
        FROM kencanaprint.tdtf d
        LEFT JOIN tsodtf_hdr h ON h.sd_nomor = d.spk_nomor
        WHERE d.tanggal = ? AND d.cab = ?;
    `;
  const [rows] = await pool.query(query, [tanggal, cabang]);
  return rows; // Kembalikan array data langsung
};

const searchSoPo = async (term, cabang, tipe) => {
  const searchTerm = `%${term || ""}%`;
  let query = "";
  let params = [];

  // --- LOGIKA PEMILIHAN QUERY BERDASARKAN TIPE ---
  if (tipe === "SO") {
    // Query hanya untuk SO DTF (logika F1 / bantuankode)
    query = `
            SELECT 
                h.sd_nomor AS kode,
                h.sd_nama AS nama,
                (SELECT SUM(sdd_jumlah) FROM tsodtf_dtl WHERE sdd_nomor = h.sd_nomor) AS jumlah,
                h.sd_tanggal AS tanggal,
                'SO DTF' AS tipe
            FROM tsodtf_hdr h 
            WHERE (LEFT(h.sd_nomor, 3) = ? OR sd_workshop = ?)
              AND (h.sd_nomor LIKE ? OR h.sd_nama LIKE ?)
            ORDER BY h.sd_tanggal DESC;
        `;
    params = [cabang, cabang, searchTerm, searchTerm];
  } else if (tipe === "PO") {
    // Query hanya untuk PO DTF (logika F2 / bantuanpo)
    query = `
            SELECT 
                h.pjh_nomor AS kode,
                h.pjh_ket AS nama,
                0 AS jumlah,
                h.pjh_tanggal AS tanggal,
                'PO DTF' as tipe
            FROM kencanaprint.tpodtf_hdr h
            WHERE h.pjh_kode_kaosan = ?
              AND (h.pjh_nomor LIKE ? OR h.pjh_ket LIKE ?)
            ORDER BY h.pjh_nomor DESC;
        `;
    params = [cabang, searchTerm, searchTerm];
  } else {
    // Logika gabungan (default jika tipe tidak ditentukan)
    // (Ini adalah kode Anda sebelumnya, kita pertahankan sebagai fallback)
    query = `
            (SELECT h.sd_nomor AS kode, h.sd_nama AS nama, (SELECT SUM(sdd_jumlah) FROM tsodtf_dtl WHERE sdd_nomor = h.sd_nomor) AS jumlah, h.sd_tanggal AS tanggal, 'SO DTF' AS tipe
            FROM tsodtf_hdr h 
            WHERE (LEFT(h.sd_nomor, 3) = ? OR sd_workshop = ?) AND (h.sd_nomor LIKE ? OR h.sd_nama LIKE ?))
            UNION ALL
            (SELECT h.pjh_nomor AS kode, h.pjh_ket AS nama, 0 AS jumlah, h.pjh_tanggal AS tanggal, 'PO DTF' as tipe
            FROM kencanaprint.tpodtf_hdr h
            WHERE h.pjh_kode_kaosan = ? AND (h.pjh_nomor LIKE ? OR h.pjh_ket LIKE ?))
            ORDER BY tanggal DESC LIMIT 50
        `;
    params = [
      cabang,
      cabang,
      searchTerm,
      searchTerm,
      cabang,
      searchTerm,
      searchTerm,
    ];
  }
  // --- AKHIR LOGIKA ---

  const [rows] = await pool.query(query, params);
  return rows;
};

const saveData = async (data, user) => {
  const { tanggal, cabang, items } = data;
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    // Pola "delete-then-insert" seperti di Delphi
    // 1. Hapus semua data LHK untuk tanggal dan cabang ini
    await connection.query("DELETE FROM tdtf WHERE tanggal = ? AND cab = ?", [
      tanggal,
      cabang,
    ]);

    // 2. Insert semua baris baru dari grid
    for (const item of items) {
      if (item.kode && item.nama) {
        // Hanya simpan baris yang valid
        const insertQuery = `
                    INSERT INTO tdtf 
                    (tanggal, spk_nomor, depan, belakang, lengan, variasi, saku, panjang, buangan, keterangan, cab, user_create, date_create) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                `;
        await connection.query(insertQuery, [
          tanggal,
          item.kode,
          item.depan || 0,
          item.belakang || 0,
          item.lengan || 0,
          item.variasi || 0,
          item.saku || 0,
          item.panjang || 0,
          item.buangan || 0,
          item.ket,
          cabang,
          user.kode,
        ]);
      }
    }

    await connection.commit();
    return { message: `Data LHK untuk tanggal ${tanggal} berhasil disimpan.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const removeData = async (tanggal, cabang) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Cek data ada atau tidak sebelum dihapus
    const [rows] = await connection.query(
      "SELECT COUNT(*) as count FROM tdtf WHERE tanggal = ? AND cab = ?",
      [tanggal, cabang]
    );
    if (rows[0].count === 0)
      throw new Error(
        "Tidak ada data LHK untuk dihapus pada tanggal dan cabang ini."
      );

    // Hapus semua data LHK untuk tanggal dan cabang tersebut
    await connection.query("DELETE FROM tdtf WHERE tanggal = ? AND cab = ?", [
      tanggal,
      cabang,
    ]);

    await connection.commit();
    return {
      message: `Data LHK untuk tanggal ${tanggal} di cabang ${cabang} berhasil dihapus.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  loadData,
  searchSoPo,
  saveData,
  removeData,
};
