const pool = require("../config/database");
const { format } = require("date-fns");

// Ambil opsi cabang untuk filter
const getCabangOptions = async (user) => {
  const userCabang = user?.cabang || "";
  const isStore = /^K\d+/.test(userCabang);

  let whereClause = "";
  let params = [];

  if (isStore) {
    // Store hanya lihat KDC dan cabangnya sendiri
    whereClause = `WHERE gdg_kode IN ('KDC', ?)`;
    params.push(userCabang);
  }
  // KDC tidak ada filter — lihat semua

  const [rows] = await pool.query(
    `SELECT gdg_kode AS kode, gdg_nama AS nama 
     FROM tgudang 
     ${whereClause}
     ORDER BY gdg_kode`,
    params,
  );
  return rows;
};

// Laporan stok bahan (acc + obat) dari tmasterstok_bahan
const getStokBahan = async (filters, user) => {
  let { cabang, jenis, keyword, tanggal, tampilkanKosong } = filters;

  const userCabang = user?.cabang || "";
  const isStore = /^K\d+/.test(userCabang);

  // --- Validasi akses cabang untuk store ---
  // Store hanya boleh lihat KDC dan cabangnya sendiri
  if (
    isStore &&
    cabang &&
    cabang !== "ALL" &&
    cabang !== "KDC" &&
    cabang !== userCabang
  ) {
    cabang = userCabang; // paksa balik ke cabangnya sendiri
  }

  let params = [tanggal];
  let cabangFilter;

  if (isStore && (!cabang || cabang === "ALL")) {
    // Store pilih Semua → hanya KDC + cabang sendiri
    cabangFilter = `s.mst_cab IN ('KDC', ?)`;
    params.push(userCabang);
  } else if (!cabang || cabang === "ALL") {
    // KDC pilih Semua → tampilkan semua
    cabangFilter = "1 = 1";
  } else {
    // Filter spesifik satu cabang
    cabangFilter = `s.mst_cab = ?`;
    params.push(cabang);
  }

  let jenisFilter = "";
  if (jenis && jenis !== "ALL") {
    jenisFilter = `AND s.mst_jenis = ?`;
    params.push(jenis);
  }

  let searchFilter = "";
  if (keyword && keyword.trim() !== "") {
    const term = `%${keyword.trim()}%`;
    searchFilter = `AND (s.mst_brg_kode LIKE ? OR b.brg_nama LIKE ?)`;
    params.push(term, term);
  }

  const havingClause = !tampilkanKosong ? "HAVING stok <> 0" : "";

  const query = `
    SELECT
      s.mst_brg_kode                           AS Kode,
      IFNULL(b.brg_nama, s.mst_brg_kode)       AS Nama,
      IFNULL(b.brg_satuan, '-')                 AS Satuan,
      s.mst_jenis                               AS Jenis,
      IFNULL(g.gdg_nama, s.mst_cab)             AS Cabang,
      s.mst_cab                                 AS KodeCabang,
      SUM(s.mst_stok_in)                        AS TotalMasuk,
      SUM(s.mst_stok_out)                       AS TotalKeluar,
      SUM(s.mst_stok_in - s.mst_stok_out)       AS stok
    FROM tmasterstok_bahan s
    LEFT JOIN kencanaprint.tgarmen_brg b ON b.brg_kode = s.mst_brg_kode
    LEFT JOIN tgudang g ON g.gdg_kode = s.mst_cab
    WHERE s.mst_aktif = 'Y'
      AND s.mst_tanggal <= ?
      AND ${cabangFilter}
      ${jenisFilter}
      ${searchFilter}
    GROUP BY s.mst_brg_kode, s.mst_jenis, s.mst_cab
    ${havingClause}
    ORDER BY s.mst_jenis, Nama, s.mst_brg_kode
  `;

  const [rows] = await pool.query(query, params);
  return rows;
};

// Kartu stok per kode barang
const getKartuStokBahan = async (filters, user) => {
  let { cabang, kodeBarang, tanggalAwal, tanggalAkhir } = filters;

  if (!kodeBarang) throw new Error("Kode barang diperlukan.");

  const userCabang = user?.cabang || "";
  const isStore = /^K\d+/.test(userCabang);

  // --- Validasi akses cabang untuk store ---
  if (
    isStore &&
    cabang &&
    cabang !== "ALL" &&
    cabang !== "KDC" &&
    cabang !== userCabang
  ) {
    cabang = userCabang; // Paksa kembali ke cabangnya sendiri
  }

  let params = [kodeBarang];
  let cabangFilter = "";

  if (isStore && (!cabang || cabang === "ALL")) {
    // Store pilih Semua -> hanya KDC + cabang sendiri
    cabangFilter = `AND s.mst_cab IN ('KDC', ?)`;
    params.push(userCabang);
  } else if (!cabang || cabang === "ALL") {
    // KDC pilih Semua -> tidak ada filter cabang
    cabangFilter = "";
  } else {
    cabangFilter = `AND s.mst_cab = ?`;
    params.push(cabang);
  }

  if (tanggalAwal) params.push(tanggalAwal);
  if (tanggalAkhir) params.push(tanggalAkhir);

  const query = `
    SELECT
      s.mst_noreferensi AS Referensi,
      s.mst_tanggal     AS Tanggal,
      s.mst_jenis       AS Jenis,
      IFNULL(g.gdg_nama, s.mst_cab) AS Cabang,
      s.mst_stok_in     AS Masuk,
      s.mst_stok_out    AS Keluar,
      s.mst_ket         AS Keterangan,
      s.mst_user        AS User,
      IFNULL(b.brg_nama, s.mst_brg_kode) AS NamaBarang,
      IFNULL(b.brg_satuan, '-')          AS Satuan
    FROM tmasterstok_bahan s
    LEFT JOIN kencanaprint.tgarmen_brg b ON b.brg_kode = s.mst_brg_kode
    LEFT JOIN tgudang g ON g.gdg_kode = s.mst_cab
    WHERE s.mst_brg_kode = ?
      AND s.mst_aktif = 'Y'
      ${cabangFilter}
      ${tanggalAwal ? "AND s.mst_tanggal >= ?" : ""}
      ${tanggalAkhir ? "AND s.mst_tanggal <= ?" : ""}
    ORDER BY s.mst_tanggal DESC, s.id DESC
  `;
  // Diubah ORDER BY DESC agar data terbaru (mutasi terakhir) berada paling atas

  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getCabangOptions,
  getStokBahan,
  getKartuStokBahan,
};
