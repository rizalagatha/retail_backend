const pool = require("../config/database");

const getLhkList = async (filters) => {
  const { startDate, endDate, cabang } = filters;
  const cabFilter = cabang === "ALL" ? "" : "AND d.cab = ?";

  const query = `
    SELECT 
        d.lhk_nomor AS NomorLhk,
        DATE_FORMAT(d.tanggal, '%Y-%m-%d') AS Tanggal,
        
        -- LOGIKA STORE PEMINTA (3 Digit Awal)
        MAX(CASE 
            WHEN d.sodtf LIKE 'SPK%' 
              OR d.sodtf LIKE 'SM%' 
              OR d.sodtf LIKE 'KP%' 
              OR d.sodtf LIKE 'JA%' 
              OR d.sodtf LIKE 'MD%' 
              OR d.sodtf LIKE 'JER%' THEN 'JERON' 
            ELSE IFNULL(g_peminta.gdg_nama, g_pengerja.gdg_nama) 
        END) AS NamaCabang,
        
        d.jo_kode,
        jo.jo_nama AS NamaJenisOrder,
        MAX(d.panjang) AS PanjangMtr,
        MAX(d.buangan) AS BuanganMtr,
        MAX(d.luas_riil) AS LuasRiil,
        SUM(CASE WHEN d.jo_kode = 'BR' THEN 0 ELSE d.luas_sistem END) AS TotalLuasSistem,
        (MAX(d.luas_riil) - SUM(CASE WHEN d.jo_kode = 'BR' THEN 0 ELSE d.luas_sistem END)) AS Selisih,
        
        -- AKUMULASI JUMLAH & REJECT
        SUM(d.jumlah_sistem) AS TotalJumlahSistem,
        SUM(d.jumlah) AS TotalJumlahRiil,
        SUM(d.reject) AS TotalReject,
        
        COUNT(d.sodtf) as TotalOrder,
        IF(MAX(d.luas_riil) > 0, 
           ROUND((SUM(CASE WHEN d.jo_kode = 'BR' THEN 0 ELSE d.luas_sistem END) / MAX(d.luas_riil)) * 100, 1), 
           0) AS Ratio
    FROM tdtf d
    LEFT JOIN kencanaprint.tjenisorder jo ON jo.jo_kode = d.jo_kode
    -- Join ke Store Peminta (3 Digit Nomor Order)
    LEFT JOIN tgudang g_peminta ON g_peminta.gdg_kode = LEFT(d.sodtf, 3)
    -- Join ke Store Pengerja (Fallback)
    LEFT JOIN tgudang g_pengerja ON g_pengerja.gdg_kode = d.cab
    
    WHERE d.tanggal BETWEEN ? AND ? ${cabFilter}
    GROUP BY d.lhk_nomor, d.tanggal, d.jo_kode, jo.jo_nama
    ORDER BY d.tanggal DESC, d.lhk_nomor DESC
  `;

  const params = [startDate, endDate];
  if (cabang !== "ALL") params.push(cabang);

  const [rows] = await pool.query(query, params);
  return rows;
};

// API baru untuk mengambil detail SO di dalam satu Nomor LHK
const getLhkDetail = async (nomorLhk) => {
  const query = `
    SELECT 
        d.sodtf AS SoDtf,
        -- Ambil nama dari SO DTF, jika kosong ambil dari SPK
        COALESCE(h.sd_nama, s.spk_nama, d.sodtf) AS NamaDtf,
        d.depan, d.belakang, d.lengan, d.variasi, d.saku,
        d.jumlah AS JumlahRiil,
        d.jumlah_sistem AS JumlahSistem,
        d.reject AS Reject,
        d.keterangan AS Keterangan,
        d.luas_sistem AS LuasSistem
    FROM tdtf d
    LEFT JOIN tsodtf_hdr h ON h.sd_nomor = d.sodtf
    -- Tambahkan Join ke tabel tspk
    LEFT JOIN tspk s ON s.spk_nomor = d.sodtf
    WHERE d.lhk_nomor = ?
  `;
  const [rows] = await pool.query(query, [nomorLhk]);
  return rows;
};

const getCabangList = async (user) => {
  let query;
  if (user.cabang === "KDC") {
    // Query untuk KDC tetap sama
    query =
      'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode="KDC" OR gdg_dc=0 ORDER BY gdg_kode';
  } else {
    // Query untuk cabang lain tetap sama
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?";
  }
  const [rows] = await pool.query(query, [user.cabang]);

  // Langsung kembalikan hasilnya tanpa menambahkan "ALL"
  return rows;
};

const remove = async (nomorLhk, user) => {
  // [FIX] Validasi tipe data agar tidak menyebabkan SQL Syntax Error
  if (!nomorLhk || typeof nomorLhk !== "string") {
    throw new Error(
      "Parameter nomorLhk harus berupa string dan tidak boleh kosong.",
    );
  }

  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    // Cek keberadaan data dan cabang
    const [rows] = await connection.query(
      "SELECT cab FROM tdtf WHERE lhk_nomor = ? LIMIT 1",
      [nomorLhk], // Pastikan ini adalah string tunggal
    );

    if (rows.length === 0) {
      throw new Error("Data LHK tidak ditemukan.");
    }

    const recordCabang = rows[0].cab;
    if (user.cabang !== "KDC" && recordCabang !== user.cabang) {
      throw new Error("Data tersebut bukan milik cabang Anda.");
    }

    // Hapus seluruh detail di bawah nomor LHK tersebut
    await connection.query("DELETE FROM tdtf WHERE lhk_nomor = ?", [nomorLhk]);

    await connection.commit();
    return { message: "Data LHK berhasil dihapus." };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  getLhkList,
  getLhkDetail,
  getCabangList,
  remove,
};
