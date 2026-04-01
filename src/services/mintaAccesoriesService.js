const pool = require("../config/database");
const { format } = require("date-fns");

// --- HELPER FUNCTION ---
const toSqlDate = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : format(d, "yyyy-MM-dd");
};

// --- GET ALL (BROWSE) ---
const getAll = async (filters, user) => {
  const { startDate, endDate, cabang, keyword } = filters;

  let query = `
    SELECT 
      h.min_nomor AS nomor,
      h.min_tanggal AS tanggal,
      h.date_create AS created,
      h.min_cab AS cab,
      h.min_ket AS keterangan,
      h.user_create AS usr,
      IF(h.min_close=0, 'OPEN', IF(h.min_close=1, 'CLOSE', IF(h.min_close=9, 'DICLOSE', 'ONPROSES'))) AS status,
      h.min_alasanclose AS alasanClose,
      
      -- Cek Realisasi (Apakah sudah di ACC produksi)
      IFNULL((SELECT COUNT(*) FROM kencanaprint.taccproduksiminta_hdr q WHERE q.promin_minta = h.min_nomor), 0) AS totr,
      IFNULL((SELECT COUNT(*) FROM kencanaprint.taccproduksiminta_hdr q WHERE q.promin_minta = h.min_nomor AND q.promin_apv IS NOT NULL), 0) AS tota,
      
      -- Status Approve
      IF(
        IFNULL((SELECT COUNT(*) FROM kencanaprint.taccproduksiminta_hdr q WHERE q.promin_minta = h.min_nomor), 0) = 0,
        '',
        IF(
          IFNULL((SELECT COUNT(*) FROM kencanaprint.taccproduksiminta_hdr q WHERE q.promin_minta = h.min_nomor AND q.promin_apv IS NOT NULL), 0) < 
          IFNULL((SELECT COUNT(*) FROM kencanaprint.taccproduksiminta_hdr q WHERE q.promin_minta = h.min_nomor), 0),
          'N',
          'Y'
        )
      ) AS approve
      
    FROM kencanaprint.taccmintabahan_hdr h
    WHERE h.min_tanggal >= ? AND h.min_tanggal <= ?
  `;

  const params = [startDate, endDate];

  // Filter Cabang (Default P03 sesuai kebutuhan)
  if (cabang && cabang !== "ALL") {
    query += ` AND h.min_cab = ?`;
    params.push(cabang);
  }

  // Filter Keyword (Pencarian)
  if (keyword) {
    query += ` AND (h.min_nomor LIKE ? OR h.min_ket LIKE ?)`;
    const searchPattern = `%${keyword}%`;
    params.push(searchPattern, searchPattern);
  }

  query += ` ORDER BY h.date_create DESC`;

  const [rows] = await pool.query(query, params);
  return rows;
};

// --- GET DETAILS (EXPAND ROW) ---
const getDetails = async (nomor) => {
  // 1. Ambil Data Realisasi (Tabel Kiri Bawah)
  const realisasiQuery = `
    SELECT 
      h.promin_nomor AS nomor,
      h.promin_tanggal AS tanggal,
      h.promin_apv AS approve,
      SUM(d.promind_Jumlah) AS jumlah,
      h.promin_keterangan AS ket
    FROM kencanaprint.taccproduksiminta_hdr h
    INNER JOIN kencanaprint.taccproduksiminta_dtl d ON d.promind_nomor = h.promin_nomor
    WHERE h.promin_minta = ?
    GROUP BY h.promin_nomor
    ORDER BY h.promin_nomor ASC
  `;
  const [realisasiRows] = await pool.query(realisasiQuery, [nomor]);

  // 2. Ambil Data Detail Barang Minta (Tabel Atas)
  const itemsQuery = `
    SELECT 
      d.mind_acc_kode AS kode,
      b.acc_nama AS nama,
      b.acc_satuan AS satuan,
      b.acc_note AS note,
      d.mind_jumlah AS jumlah,
      
      -- Hitung total yang sudah direalisasikan untuk barang ini
      IFNULL((
        SELECT SUM(rd.promind_jumlah)
        FROM kencanaprint.taccproduksiminta_dtl rd
        INNER JOIN kencanaprint.taccproduksiminta_hdr rh ON rh.promin_nomor = rd.promind_nomor
        WHERE rh.promin_minta = d.mind_nomor AND rd.promind_acc_kode = d.mind_acc_kode
      ), 0) AS realisasi,
      
      d.mind_ket AS keterangan
    FROM kencanaprint.taccmintabahan_dtl d
    LEFT JOIN kencanaprint.taccesories b ON b.acc_kode = d.mind_acc_kode
    WHERE d.mind_nomor = ?
    ORDER BY d.mind_acc_kode ASC
  `;
  const [itemsRows] = await pool.query(itemsQuery, [nomor]);

  // 3. [BARU] Ambil Data Detail Realisasi (Tabel Kanan Bawah)
  const realisasiDetailsQuery = `
    SELECT 
      d.promind_nomor AS realisasi_nomor,
      d.promind_acc_kode AS kode,
      b.acc_nama AS nama,
      b.acc_satuan AS satuan,
      d.promind_jumlah AS jumlah
    FROM kencanaprint.taccproduksiminta_dtl d
    LEFT JOIN kencanaprint.taccesories b ON b.acc_kode = d.promind_acc_kode
    WHERE d.promind_nomor IN (SELECT promin_nomor FROM kencanaprint.taccproduksiminta_hdr WHERE promin_minta = ?)
    ORDER BY d.promind_nomor ASC, d.promind_acc_kode ASC
  `;
  const [realisasiDetailsRows] = await pool.query(realisasiDetailsQuery, [
    nomor,
  ]);

  const formattedRealisasi = realisasiRows.map((r) => ({
    ...r,
    tanggal: r.tanggal ? format(new Date(r.tanggal), "dd/MM/yyyy") : "",
    approve: r.approve ? format(new Date(r.approve), "dd/MM/yyyy") : "",
  }));

  return {
    realisasi: formattedRealisasi,
    items: itemsRows,
    realisasiDetails: realisasiDetailsRows, // <--- Data untuk tabel ke-3
  };
};

// --- DELETE ---
const deletePermintaan = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Cek Status (Hanya OPEN yang boleh dihapus)
    const [cekStatus] = await connection.query(
      `SELECT min_close FROM kencanaprint.taccmintabahan_hdr WHERE min_nomor = ?`,
      [nomor],
    );

    if (cekStatus.length === 0) throw new Error("Data tidak ditemukan.");
    if (cekStatus[0].min_close !== 0)
      throw new Error("Data sudah diproses atau di-close. Tidak bisa dihapus.");

    // 2. Hapus Data (Header & Detail)
    await connection.query(
      `DELETE FROM kencanaprint.taccmintabahan_hdr WHERE min_nomor = ?`,
      [nomor],
    );
    await connection.query(
      `DELETE FROM kencanaprint.taccmintabahan_dtl WHERE mind_nomor = ?`,
      [nomor],
    );

    await connection.commit();
    return { message: "Data berhasil dihapus." };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// --- CLOSE MANUAL ---
const closeManual = async (nomor, alasan, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [cekStatus] = await connection.query(
      `SELECT min_close FROM kencanaprint.taccmintabahan_hdr WHERE min_nomor = ?`,
      [nomor],
    );

    if (cekStatus.length === 0) throw new Error("Data tidak ditemukan.");
    if (cekStatus[0].min_close === 9 || cekStatus[0].min_close === 1) {
      throw new Error("Data sudah berstatus CLOSE.");
    }

    // Set min_close = 9 (Di-close manual)
    await connection.query(
      `UPDATE taccmintabahan_hdr 
       SET min_close = 9, min_alasanclose = ?, user_modified = ?, date_modified = NOW() 
       WHERE min_nomor = ?`,
      [alasan, user.kode, nomor],
    );

    await connection.commit();
    return { message: "Permintaan berhasil di-close manual." };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// Cek apakah user punya realisasi yang belum di-approve > 1 hari
const checkUnapprovedRealisasi = async (userKode) => {
  const query = `
    SELECT IFNULL(COUNT(*), 0) as unapprovedCount
    FROM kencanaprint.taccproduksiminta_hdr h
    INNER JOIN kencanaprint.taccmintabahan_hdr a 
      ON a.min_nomor = h.promin_minta AND a.user_create = ?
    WHERE h.promin_minta <> "" 
      AND h.promin_apv IS NULL 
      AND h.promin_tanggal < DATE_ADD(CURDATE(), INTERVAL -1 DAY)
  `;
  const [rows] = await pool.query(query, [userKode]);
  return rows[0].unapprovedCount;
};

// Eksekusi Approve Realisasi
const approveRealisasi = async (prominNomor) => {
  const query = `
    UPDATE kencanaprint.taccproduksiminta_hdr 
    SET promin_apv = NOW() 
    WHERE promin_nomor = ?
  `;
  const [result] = await pool.query(query, [prominNomor]);
  return result.affectedRows > 0;
};

module.exports = {
  getAll,
  getDetails,
  deletePermintaan,
  closeManual,
  checkUnapprovedRealisasi,
  approveRealisasi,
};
