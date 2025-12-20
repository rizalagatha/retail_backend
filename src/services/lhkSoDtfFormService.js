const pool = require("../config/database");

const loadData = async (tanggal, cabang) => {
  const query = `
    SELECT 
      d.sodtf AS kode,
      h.sd_nama AS nama,
      d.depan,
      d.belakang,
      d.lengan,
      d.variasi,
      d.saku,
      d.panjang,
      d.buangan,
      d.keterangan AS ket
    FROM retail.tdtf d
    LEFT JOIN retail.tsodtf_hdr h ON h.sd_nomor = d.sodtf
    WHERE d.tanggal = ? AND d.cab = ?;
  `;
  const [rows] = await pool.query(query, [tanggal, cabang]);
  return rows;
};

const searchSoPo = async (term, cabang, tipe, page = 1, limit = 50) => {
  const searchTerm = `%${term || ""}%`;
  const offset = (page - 1) * limit;
  let query = "";
  let params = [];

  if (tipe === "SO") {
    // 🔹 Query untuk SO DTF saja
    query = `
      SELECT 
          h.sd_nomor AS kode,
          h.sd_nama AS nama,
          (SELECT SUM(sdd_jumlah) FROM tsodtf_dtl WHERE sdd_nomor = h.sd_nomor) AS jumlah,
          h.sd_tanggal AS tanggal,
          'SO DTF' AS tipe
      FROM retail.tsodtf_hdr h 
      WHERE (h.sd_cab = ? OR h.sd_workshop = ?)
    `;
    params = [cabang, cabang];

    if (term) {
      query += ` AND (h.sd_nomor LIKE ? OR h.sd_nama LIKE ?)`;
      params.push(searchTerm, searchTerm);
    }

    // 🔹 Tambahkan pagination di akhir
    query += ` ORDER BY h.sd_tanggal DESC LIMIT ? OFFSET ?;`;
    params.push(Number(limit), Number(offset));
  } else if (tipe === "PO") {
    // 🔹 Query untuk PO DTF saja
    query = `
      SELECT 
          h.pjh_nomor AS kode,
          h.pjh_ket AS nama,
          0 AS jumlah,
          h.pjh_tanggal AS tanggal,
          'PO DTF' AS tipe
      FROM kencanaprint.tpodtf_hdr h
      WHERE h.pjh_kode_kaosan = ?
    `;
    params = [cabang];

    if (term) {
      query += ` AND (h.pjh_nomor LIKE ? OR h.pjh_ket LIKE ?)`;
      params.push(searchTerm, searchTerm);
    }

    // 🔹 Pagination
    query += ` ORDER BY h.pjh_nomor DESC LIMIT ? OFFSET ?;`;
    params.push(Number(limit), Number(offset));
  } else {
    // 🔹 Default: gabungan SO + PO (jika tipe = ALL atau undefined)
    query = `
      (SELECT 
          h.sd_nomor AS kode, 
          h.sd_nama AS nama, 
          (SELECT SUM(sdd_jumlah) FROM tsodtf_dtl WHERE sdd_nomor = h.sd_nomor) AS jumlah, 
          h.sd_tanggal AS tanggal, 
          'SO DTF' AS tipe
        FROM retail.tsodtf_hdr h 
        WHERE (h.sd_cab = ? OR h.sd_workshop = ?) 
          AND (h.sd_nomor LIKE ? OR h.sd_nama LIKE ?)
      )
      UNION ALL
      (SELECT 
          h.pjh_nomor AS kode, 
          h.pjh_ket AS nama, 
          0 AS jumlah, 
          h.pjh_tanggal AS tanggal, 
          'PO DTF' AS tipe
        FROM kencanaprint.tpodtf_hdr h
        WHERE h.pjh_kode_kaosan = ? 
          AND (h.pjh_nomor LIKE ? OR h.pjh_ket LIKE ?)
      )
      ORDER BY tanggal DESC 
      LIMIT ? OFFSET ?;
    `;
    params = [
      cabang,
      cabang,
      searchTerm,
      searchTerm,
      cabang,
      searchTerm,
      searchTerm,
      Number(limit),
      Number(offset),
    ];
  }

  // 🧩 Ambil data page tertentu
  const [rows] = await pool.query(query, params);

  // 🧩 Hitung total data (untuk pagination UI)
  let countQuery = "";
  let countParams = [];

  if (tipe === "SO") {
    countQuery = `
      SELECT COUNT(*) AS total
      FROM retail.tsodtf_hdr h
      WHERE (h.sd_cab = ? OR h.sd_workshop = ?)
    `;
    countParams = [cabang, cabang];
    if (term) {
      countQuery += ` AND (h.sd_nomor LIKE ? OR h.sd_nama LIKE ?)`;
      countParams.push(searchTerm, searchTerm);
    }
  } else if (tipe === "PO") {
    countQuery = `
      SELECT COUNT(*) AS total
      FROM kencanaprint.tpodtf_hdr h
      WHERE h.pjh_kode_kaosan = ?
    `;
    countParams = [cabang];
    if (term) {
      countQuery += ` AND (h.pjh_nomor LIKE ? OR h.pjh_ket LIKE ?)`;
      countParams.push(searchTerm, searchTerm);
    }
  } else {
    countQuery = `
      SELECT (
        (SELECT COUNT(*) 
         FROM retail.tsodtf_hdr h 
         WHERE (h.sd_cab= ? OR h.sd_workshop = ?)
           AND (h.sd_nomor LIKE ? OR h.sd_nama LIKE ?))
        +
        (SELECT COUNT(*) 
         FROM kencanaprint.tpodtf_hdr h
         WHERE h.pjh_kode_kaosan = ? 
           AND (h.pjh_nomor LIKE ? OR h.pjh_ket LIKE ?))
      ) AS total;
    `;
    countParams = [
      cabang,
      cabang,
      searchTerm,
      searchTerm,
      cabang,
      searchTerm,
      searchTerm,
    ];
  }

  const [countRows] = await pool.query(countQuery, countParams);
  const total = countRows[0]?.total || 0;

  // ✅ Return dalam bentuk object pagination-friendly
  return {
    data: rows,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
  };
};

const saveData = async (data, user) => {
  const { tanggal, cabang, items } = data;
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    await connection.query(
      "DELETE FROM retail.tdtf WHERE tanggal = ? AND cab = ?",
      [tanggal, cabang]
    );

    for (const item of items) {
      if (item.kode && item.nama) {
        const insertQuery = `
          INSERT INTO retail.tdtf 
            (tanggal, sodtf, depan, belakang, lengan, variasi, saku, panjang, buangan, keterangan, cab, user_create, date_create) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;
        await connection.query(insertQuery, [
          tanggal,
          item.kode, // sodtf
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

    const [rows] = await connection.query(
      "SELECT COUNT(*) AS count FROM retail.tdtf WHERE tanggal = ? AND cab = ?",
      [tanggal, cabang]
    );

    if (rows[0].count === 0)
      throw new Error(
        "Tidak ada data LHK untuk dihapus pada tanggal dan cabang ini."
      );

    await connection.query(
      "DELETE FROM retail.tdtf WHERE tanggal = ? AND cab = ?",
      [tanggal, cabang]
    );

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
