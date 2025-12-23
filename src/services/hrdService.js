const pool = require("../config/database"); // Gunakan pool yang sama
const { format, startOfMonth, endOfMonth } = require("date-fns");

const LIMIT_BELANJA_KARYAWAN = 500000;

const getKaryawanInfo = async (nik) => {
  // 1. Ambil Data Karyawan dari DB hrd2 (Query lintas database)
  const queryKaryawan = `
    SELECT kar_nik, kar_nama, kar_alamat, kar_status_aktif
    FROM hrd2.tkaryawan 
    WHERE kar_nik = ?
  `;
  
  const [employees] = await pool.query(queryKaryawan, [nik]);
  
  if (employees.length === 0) {
    return { found: false, message: "NIK Karyawan tidak ditemukan." };
  }

  const karyawan = employees[0];

  // ============================================================
  // UPDATE LOGIKA STATUS AKTIF (1 = Aktif, 0 = Tidak Aktif)
  // ============================================================
  // Kita konversi ke String dulu jaga-jaga kalau dari DB tipenya integer
  if (String(karyawan.kar_status_aktif) !== '1') {
    return { 
        found: true, 
        active: false, 
        message: `Karyawan Tidak Aktif (Status: ${karyawan.kar_status_aktif})` 
    };
  }

  // 2. Hitung Pemakaian Limit Bulan Ini (Dari Tabel Piutang Toko)
  const now = new Date();
  const startDate = format(startOfMonth(now), 'yyyy-MM-dd');
  const endDate = format(endOfMonth(now), 'yyyy-MM-dd');

  // Query ini menghitung total bon gantung (piutang) karyawan tersebut bulan ini
  const queryUsage = `
    SELECT COALESCE(SUM(ph_nominal), 0) as total_usage
    FROM tpiutang_hdr
    WHERE ph_cus_kode = ? 
      AND ph_tanggal BETWEEN ? AND ?
  `;
  
  const [usageRows] = await pool.query(queryUsage, [nik, startDate, endDate]);
  const currentUsage = Number(usageRows[0].total_usage);
  
  // Hitung sisa limit
  const sisaLimit = LIMIT_BELANJA_KARYAWAN - currentUsage;

  return {
    found: true,
    active: true,
    data: {
      nik: karyawan.kar_nik,
      nama: karyawan.kar_nama,
      alamat: karyawan.kar_alamat,
      limitTotal: LIMIT_BELANJA_KARYAWAN,
      terpakaiBulanIni: currentUsage,
      sisaLimit: sisaLimit
    }
  };
};

const searchKaryawan = async (term) => {
  if (!term || term.length < 3) return []; // Minimal 3 karakter biar gak berat

  const searchTerm = `%${term}%`;

  // Query Pencarian Pintar
  // Mencari di NIK atau Nama, hanya yang statusnya Aktif
  const query = `
    SELECT kar_nik, kar_nama, kar_alamat
    FROM hrd2.tkaryawan
    WHERE (kar_status_aktif = '1' OR kar_status_aktif = 'Y')
      AND (kar_nik LIKE ? OR kar_nama LIKE ?)
    LIMIT 20; -- Batasi hasil maksimal 20 agar UI tidak lag
  `;

  const [rows] = await pool.query(query, [searchTerm, searchTerm]);
  return rows;
};

module.exports = {
  getKaryawanInfo, 
  searchKaryawan
};