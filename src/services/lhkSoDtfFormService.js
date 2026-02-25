const pool = require("../config/database");
const { format } = require("date-fns");

/**
 * @description Membuat nomor LHK dengan format baru: cabang.LHK.yyMM.0001
 */
const generateLhkNumber = async (connection, cabang) => {
  const date = new Date();
  const yyMM = format(date, "yyMM");
  // Format baru: {cabang}.LHK.{tahunbulan}.
  const prefix = `${cabang}.LHK.${yyMM}.`;

  const query = `
    SELECT lhk_nomor 
    FROM tdtf 
    WHERE lhk_nomor LIKE ? 
    ORDER BY lhk_nomor DESC 
    LIMIT 1
  `;

  const [rows] = await connection.query(query, [`${prefix}%`]);

  let sequence = 1;
  if (rows.length > 0) {
    const lastNomor = rows[0].lhk_nomor;
    // Mengambil 4 digit terakhir setelah titik terakhir
    const lastSeq = parseInt(lastNomor.split(".").pop());
    if (!isNaN(lastSeq)) sequence = lastSeq + 1;
  }

  return `${prefix}${sequence.toString().padStart(4, "0")}`;
};

// Fungsi Baru: Ambil Spesifikasi Luas dari Sistem
const getSoDtfSpecs = async (nomorSo) => {
  try {
    // 1. Identifikasi Tipe berdasarkan Prefix Nomor
    const isPO = nomorSo.includes(".PJ."); // Purchase Order Produksi

    // Modul DTF mencakup prefix .SD. (DTF), .DP. (DTF Premium), dan .SB. (Sablon)
    const isDTFModul =
      nomorSo.includes(".SD.") ||
      nomorSo.includes(".DP.") ||
      nomorSo.includes(".SB.") ||
      nomorSo.includes(".BR."); // <-- Tambahkan ini

    const isSOReg = nomorSo.includes(".SO."); // SO Reguler (Custom Item JSON)

    // --- RUTE A: MODUL DTF (.SD / .DP / .SB) ATAU PO PRODUKSI (.PJ) ---
    if (isDTFModul || isPO) {
      const tableDtl = isPO ? "kencanaprint.tpodtf_dtl" : "tsodtf_dtl";
      const tableDtl2 = isPO ? "kencanaprint.tpodtf_dtl2" : "tsodtf_dtl2";
      const colNo = isPO ? "pjd_nomor" : "sdd_nomor";
      const colNo2 = isPO ? "pjd2_nomor" : "sdd2_nomor";
      const colJml = isPO ? "pjd_jumlah" : "sdd_jumlah";

      // Ambil Total Jumlah Kaos
      const [qtyRows] = await pool.query(
        `SELECT SUM(${colJml}) as totalQty FROM ${tableDtl} WHERE ${colNo} = ?`,
        [nomorSo],
      );

      if (!qtyRows[0].totalQty) {
        return {
          totalLuasSistem: 0,
          totalKaos: 0,
          message: "Data tidak ditemukan di tabel detail modul pengerjaan.",
        };
      }

      // Ambil Rincian Titik Cetak (Panjang x Lebar)
      const [titikRows] = await pool.query(
        `SELECT ${isPO ? "pjd2_panjang" : "sdd2_panjang"} as panjang, 
                ${isPO ? "pjd2_lebar" : "sdd2_lebar"} as lebar 
         FROM ${tableDtl2} WHERE ${colNo2} = ?`,
        [nomorSo],
      );

      const totalKaos = Number(qtyRows[0].totalQty);
      // Kalkulasi Luas: Total Luas per Kaos x Jumlah Kaos
      const luasPerKaos = titikRows.reduce(
        (sum, t) => sum + Number(t.panjang || 0) * Number(t.lebar || 0),
        0,
      );

      return {
        totalLuasSistem: Math.round(luasPerKaos * totalKaos),
        totalKaos,
        message: `Data ditemukan di Modul Pengerjaan (${isPO ? "PO" : "SO"})`,
      };
    }

    // --- RUTE B: SO REGULER (.SO) - PARSING DATA CUSTOM (JSON) ---
    if (isSOReg) {
      const [rows] = await pool.query(
        "SELECT sod_jumlah, sod_custom, sod_custom_data FROM tso_dtl WHERE sod_so_nomor = ?",
        [nomorSo],
      );

      if (rows.length === 0)
        return {
          totalLuasSistem: 0,
          totalKaos: 0,
          message: "Nomor SO tidak ditemukan.",
        };

      let totalLuasSistem = 0;
      let totalKaos = 0;

      rows.forEach((row) => {
        const qty = Number(row.sod_jumlah || 0);
        totalKaos += qty;

        // Parsing data teknis dari kolom JSON sod_custom_data
        if (row.sod_custom === "Y" && row.sod_custom_data) {
          try {
            const custom =
              typeof row.sod_custom_data === "string"
                ? JSON.parse(row.sod_custom_data)
                : row.sod_custom_data;

            // Hitung luas berdasarkan array titikCetak di dalam objek JSON
            const luasTitik = (custom.titikCetak || []).reduce(
              (s, t) => s + Number(t.panjang || 0) * Number(t.lebar || 0),
              0,
            );
            totalLuasSistem += luasTitik * qty;
          } catch (e) {
            console.error("Gagal parse JSON pada SO Reguler", e);
          }
        }
      });

      return {
        totalLuasSistem: Math.round(totalLuasSistem),
        totalKaos,
        message: "Data ditemukan di SO Reguler (Item Custom)",
      };
    }

    return {
      totalLuasSistem: 0,
      totalKaos: 0,
      message: "Format nomor tidak didukung.",
    };
  } catch (error) {
    console.error("Error in getSoDtfSpecs expanded logic:", error);
    throw error;
  }
};

const loadData = async (nomorLhk) => {
  const query = `
    SELECT 
      d.lhk_nomor, 
      d.tanggal, 
      d.sodtf AS kode, 
      h.sd_nama AS nama,
      d.depan, 
      d.belakang, 
      d.lengan, 
      d.variasi, 
      d.saku,
      d.jumlah,
      d.jumlah_sistem,
      d.reject,
      d.panjang, 
      d.buangan, 
      d.luas_sistem, 
      d.luas_riil,
      d.keterangan AS ket,
      d.cab, -- Tambahkan kolom cab agar frontend tahu cabangnya
      d.jo_kode
    FROM tdtf d
    LEFT JOIN tsodtf_hdr h ON h.sd_nomor = d.sodtf
    WHERE d.lhk_nomor = ? -- [FIX] Filter berdasarkan Nomor LHK unik
    ORDER BY d.date_create ASC;
  `;

  // Kirim nomorLhk ke query
  const [rows] = await pool.query(query, [nomorLhk]);
  return rows;
};

const getJenisOrderList = async () => {
  const query = `
    SELECT jo_kode AS kode, jo_nama AS nama 
    FROM kencanaprint.tjenisorder 
    WHERE jo_divisi = 3 
    ORDER BY jo_nama ASC
  `;
  const [rows] = await pool.query(query);
  return rows;
};

const searchSoPo = async (term, cabang, tipe, prefix, page = 1, limit = 50) => {
  const searchTerm = `%${term || ""}%`;
  const offset = (page - 1) * limit;
  let query = "";
  let params = [];

  const patternPrefix = `%${prefix}%`;
  const exclusionFilterSO = `AND h.sd_nomor NOT IN (SELECT sodtf FROM tdtf)`;
  const exclusionFilterPO = `AND h.pjh_nomor NOT IN (SELECT sodtf FROM tdtf)`;
  const prefixFilterSO = prefix ? `AND h.sd_nomor LIKE ?` : "";
  const prefixFilterPO = prefix ? `AND h.pjh_nomor LIKE ?` : "";

  if (tipe === "SO") {
    // [FIX] Ambil Jumlah Riil dari tsodtf_dtl
    query = `
      SELECT h.sd_nomor AS kode, h.sd_nama AS nama,
             IFNULL((SELECT SUM(sdd_jumlah) FROM tsodtf_dtl WHERE sdd_nomor = h.sd_nomor), 0) AS jumlah,
             h.sd_tanggal AS tanggal, 'SO DTF' AS tipe
      FROM tsodtf_hdr h 
      WHERE (h.sd_cab = ? OR h.sd_workshop = ?) ${exclusionFilterSO} ${prefixFilterSO}
    `;
    params = [cabang, cabang];
    if (prefix) params.push(patternPrefix);

    if (term) {
      query += ` AND (h.sd_nomor LIKE ? OR h.sd_nama LIKE ?)`;
      params.push(searchTerm, searchTerm);
    }
    query += ` ORDER BY h.sd_tanggal DESC LIMIT ? OFFSET ?;`;
    params.push(Number(limit), Number(offset));
  } else if (tipe === "PO") {
    // [FIX] Ambil Jumlah Riil dari kencanaprint.tpodtf_dtl
    query = `
      SELECT h.pjh_nomor AS kode, h.pjh_ket AS nama, 
             IFNULL((SELECT SUM(pjd_jumlah) FROM kencanaprint.tpodtf_dtl WHERE pjd_nomor = h.pjh_nomor), 0) AS jumlah,
             h.pjh_tanggal AS tanggal, 'PO DTF' AS tipe
      FROM kencanaprint.tpodtf_hdr h
      WHERE h.pjh_kode_kaosan = ? ${exclusionFilterPO} ${prefixFilterPO}
    `;
    params = [cabang];
    if (prefix) params.push(patternPrefix);

    if (term) {
      query += ` AND (h.pjh_nomor LIKE ? OR h.pjh_ket LIKE ?)`;
      params.push(searchTerm, searchTerm);
    }
    query += ` ORDER BY h.pjh_nomor DESC LIMIT ? OFFSET ?;`;
    params.push(Number(limit), Number(offset));
  } else if (tipe === "SPK") {
    // [LOGIKA BARU] Pencarian SPK Produksi/Pabrik
    query = `
      SELECT spk_nomor AS kode, spk_nama AS nama, 
             0 AS jumlah, -- SPK biasanya tidak memiliki agregat jumlah di header
             spk_tanggal AS tanggal, 'SPK PABRIK' AS tipe
      FROM tspk 
      WHERE spk_aktif = 'Y' AND spk_close = 0
    `;
    if (term) {
      query += ` AND (spk_nomor LIKE ? OR spk_nama LIKE ?)`;
      params.push(searchTerm, searchTerm);
    }
    query += ` ORDER BY spk_tanggal DESC LIMIT ? OFFSET ?;`;
    params.push(Number(limit), Number(offset));
  } else {
    // Gabungan (Default)
    query = `
      (SELECT h.sd_nomor AS kode, h.sd_nama AS nama, 
              IFNULL((SELECT SUM(sdd_jumlah) FROM tsodtf_dtl WHERE sdd_nomor = h.sd_nomor), 0) AS jumlah, 
              h.sd_tanggal AS tanggal, 'SO DTF' AS tipe
       FROM tsodtf_hdr h 
       WHERE (h.sd_cab = ? OR h.sd_workshop = ?) ${exclusionFilterSO} ${prefixFilterSO}
         AND (h.sd_nomor LIKE ? OR h.sd_nama LIKE ?)
      )
      UNION ALL
      (SELECT h.pjh_nomor AS kode, h.pjh_ket AS nama, 
              IFNULL((SELECT SUM(pjd_jumlah) FROM kencanaprint.tpodtf_dtl WHERE pjd_nomor = h.pjh_nomor), 0) AS jumlah, 
              h.pjh_tanggal AS tanggal, 'PO DTF' AS tipe
       FROM kencanaprint.tpodtf_hdr h
       WHERE h.pjh_kode_kaosan = ? ${exclusionFilterPO} ${prefixFilterPO}
         AND (h.pjh_nomor LIKE ? OR h.pjh_ket LIKE ?)
      )
      ORDER BY tanggal DESC LIMIT ? OFFSET ?;
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

  const [rows] = await pool.query(query, params);

  // --- LOGIKA COUNT QUERY (PASTIKAN PARAMS SINKRON) ---
  let countQuery = "";
  let countParams = params.slice(0, -2); // Ambil params tanpa limit & offset

  if (tipe === "SO") {
    countQuery = `SELECT COUNT(*) AS total FROM tsodtf_hdr h WHERE (h.sd_cab = ? OR h.sd_workshop = ?) ${exclusionFilterSO} ${prefixFilterSO}`;
    if (term) countQuery += ` AND (h.sd_nomor LIKE ? OR h.sd_nama LIKE ?)`;
  } else if (tipe === "PO") {
    countQuery = `SELECT COUNT(*) AS total FROM kencanaprint.tpodtf_hdr h WHERE h.pjh_kode_kaosan = ? ${exclusionFilterPO} ${prefixFilterPO}`;
    if (term) countQuery += ` AND (h.pjh_nomor LIKE ? OR h.pjh_ket LIKE ?)`;
  } else if (tipe === "SPK") {
    countQuery = `SELECT COUNT(*) AS total FROM tspk WHERE spk_aktif = 'Y' AND spk_close = 0`;
    if (term) countQuery += ` AND (spk_nomor LIKE ? OR spk_nama LIKE ?)`;
  } else {
    // Gabungan Count
    countQuery = `SELECT (
        (SELECT COUNT(*) FROM tsodtf_hdr h WHERE (h.sd_cab=? OR h.sd_workshop=?) ${exclusionFilterSO} ${prefixFilterSO} AND (h.sd_nomor LIKE ? OR h.sd_nama LIKE ?)) +
        (SELECT COUNT(*) FROM kencanaprint.tpodtf_hdr h WHERE h.pjh_kode_kaosan=? ${exclusionFilterPO} ${prefixFilterPO} AND (h.pjh_nomor LIKE ? OR h.pjh_ket LIKE ?))
      ) AS total`;
  }

  const [countRows] = await pool.query(countQuery, countParams);
  const total = countRows[0]?.total || 0;

  return {
    data: rows,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
  };
};

// --- 1. Tambahkan Fungsi searchSpk ---
const searchSpk = async (term, page = 1, limit = 50) => {
  const searchTerm = `%${term || ""}%`;
  const offset = (page - 1) * limit;

  const query = `
    SELECT spk_nomor AS kode, spk_nama AS nama, 
           0 AS jumlah, spk_tanggal AS tanggal, 'SPK' AS tipe
    FROM tspk 
    WHERE spk_aktif = 'Y' AND spk_close = 0
      AND (spk_nomor LIKE ? OR spk_nama LIKE ?)
    ORDER BY spk_tanggal DESC LIMIT ? OFFSET ?
  `;
  const [rows] = await pool.query(query, [
    searchTerm,
    searchTerm,
    Number(limit),
    Number(offset),
  ]);

  const [countRows] = await pool.query(
    "SELECT COUNT(*) AS total FROM tspk WHERE spk_aktif='Y' AND spk_close=0",
    [],
  );

  return { data: rows, total: countRows[0].total };
};

const saveData = async (payload, user) => {
  const {
    tanggal,
    cabang,
    items,
    panjang,
    buangan,
    jenisOrder,
    isEdit,
    lhkNomor,
  } = payload;
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const lhkNomorFinal = isEdit
      ? lhkNomor
      : await generateLhkNumber(connection, cabang);

    if (isEdit) {
      await connection.query("DELETE FROM tdtf WHERE lhk_nomor = ?", [
        lhkNomorFinal,
      ]);
    }

    const lebarFilm = cabang === "K02" ? 30 : 60;

    const isDTF = (jenisOrder?.nama || "").toUpperCase().includes("DTF");

    const luasRiilGlobal = isDTF
      ? (Number(panjang || 0) + Number(buangan || 0)) * lebarFilm
      : 0;

    for (const item of items) {
      if (item.kode) {
        // [FIX] Cek apakah kode item diawali dengan salah satu prefix produksi JERON
        const jeronPrefixes = ["SPK", "SM", "KP", "JA", "MD", "JER"];
        const isProductionOrder = jeronPrefixes.some((p) =>
          item.kode.startsWith(p),
        );

        // Gunakan P04 jika produksi, jika tidak gunakan kode cabang pengirim (cabang pengerja)
        const finalCab = isProductionOrder ? "P04" : cabang;

        await connection.query(
          `INSERT INTO tdtf (lhk_nomor, tanggal, sodtf, depan, belakang, lengan, variasi, saku, jumlah, jumlah_sistem, reject, panjang, buangan, luas_sistem, luas_riil, jo_kode, cab, user_create, date_create) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            lhkNomorFinal,
            tanggal,
            item.kode,
            item.depan || 0,
            item.belakang || 0,
            item.lengan || 0,
            item.variasi || 0,
            item.saku || 0,
            item.jumlah || 0,
            item.jumlahSistem || 0,
            item.reject || 0,
            isDTF ? Number(panjang || 0) : 0,
            isDTF ? Number(buangan || 0) : 0,
            item.luasSistem || 0,
            luasRiilGlobal,
            jenisOrder.kode,
            finalCab,
            user.kode,
          ],
        );
      }
    }
    await connection.commit();
    return { message: "LHK Berhasil disimpan", lhkNomor };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * @description Menghapus data berdasarkan Nomor LHK tunggal
 */
const removeData = async (nomorLhk) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      "SELECT COUNT(*) AS count FROM tdtf WHERE lhk_nomor = ?",
      [nomorLhk],
    );

    if (rows[0].count === 0) throw new Error("Data LHK tidak ditemukan.");

    // Hapus seluruh baris yang memiliki nomor LHK yang sama
    await connection.query("DELETE FROM tdtf WHERE lhk_nomor = ?", [nomorLhk]);

    await connection.commit();
    return { message: `LHK ${nomorLhk} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  loadData,
  getJenisOrderList,
  searchSoPo,
  searchSpk,
  saveData,
  removeData,
  getSoDtfSpecs,
};
