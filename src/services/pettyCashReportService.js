const pool = require("../config/database");

const getMutasiReport = async (filters) => {
  const { startDate, endDate, cabang } = filters;
  const limitSaldo = 1000000;

  // 1. HITUNG SALDO AWAL (Tetap sama)
  const querySaldoAwal = `
    SELECT 
      IFNULL(SUM(CASE WHEN mut_tipe = 'DEBET' THEN mut_nominal ELSE 0 END), 0) - 
      IFNULL(SUM(CASE WHEN mut_tipe = 'KREDIT' THEN mut_nominal ELSE 0 END), 0) AS mutasi_sebelumnya
    FROM tpettycash_mutasi
    WHERE mut_cabang = ? AND DATE(mut_tanggal) < DATE(?)
  `;
  const [saldoRows] = await pool.query(querySaldoAwal, [cabang, startDate]);
  const mutasiSebelumnya = parseFloat(saldoRows[0].mutasi_sebelumnya) || 0;
  const saldoAwal = limitSaldo + mutasiSebelumnya;

  // 2. AMBIL DATA MUTASI (DIPERBAIKI)
  // Menggunakan LEFT JOIN ke detail agar mendapatkan pcd_keterangan (Keterangan dari Toko)
  const queryMutasi = `
    SELECT 
      m.mut_id,
      m.mut_tanggal as tanggal,
      m.mut_nomor_bukti as nomor_bukti,
      m.mut_tipe as tipe,
      -- Jika mutasi terhubung ke rincian PC, ambil nominal rinciannya, 
      -- jika tidak (misal mutasi DEBET/Kas Masuk), ambil nominal mutasi utuh
      IFNULL(d.pcd_nominal, m.mut_nominal) as nominal,
      -- Keterangan: Prioritaskan keterangan dari toko (pcd_keterangan), jika kosong pakai mut_keterangan
      IFNULL(d.pcd_keterangan, m.mut_keterangan) as keterangan,
      COALESCE(h.pc_status, k.pck_status) as status_ref,
      d.pcd_kategori as kategori,
      d.pcd_pcv as pcv
    FROM tpettycash_mutasi m
    LEFT JOIN tpettycash_hdr h ON m.mut_nomor_bukti = h.pc_nomor
    LEFT JOIN tpettycash_klaim_hdr k ON m.mut_nomor_bukti = k.pck_nomor
    LEFT JOIN tpettycash_dtl d ON m.mut_nomor_bukti = d.pcd_nomor
    WHERE m.mut_cabang = ? 
      AND DATE(m.mut_tanggal) >= DATE(?) 
      AND DATE(m.mut_tanggal) <= DATE(?)
    ORDER BY m.mut_tanggal ASC, m.mut_id ASC, d.pcd_nourut ASC
  `;
  const [mutasiRows] = await pool.query(queryMutasi, [
    cabang,
    startDate,
    endDate,
  ]);

  // 3. AMBIL RINGKASAN (Tetap sama)
  const queryKategori = `
    SELECT 
      d.pcd_kategori AS kategori, 
      SUM(d.pcd_nominal) AS total
    FROM tpettycash_hdr h
    INNER JOIN tpettycash_dtl d ON h.pc_nomor = d.pcd_nomor
    WHERE h.pc_cab = ? 
      AND DATE(h.pc_tanggal) >= DATE(?) 
      AND DATE(h.pc_tanggal) <= DATE(?)
      AND h.pc_status NOT IN ('DRAFT', 'REJECTED')
    GROUP BY d.pcd_kategori
    ORDER BY total DESC
  `;
  const [kategoriRows] = await pool.query(queryKategori, [
    cabang,
    startDate,
    endDate,
  ]);

  return {
    limit_saldo: limitSaldo,
    saldo_awal: saldoAwal,
    mutasi: mutasiRows,
    summary_kategori: kategoriRows,
  };
};

const getCabangList = async (user) => {
  let query;
  let params = [];

  if (user.cabang === "KDC") {
    // Pusat bisa lihat semua toko (gdg_dc = 0)
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_dc = 0 ORDER BY gdg_kode";
  } else {
    // Toko hanya bisa lihat cabangnya sendiri
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?";
    params = [user.cabang];
  }

  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = { getMutasiReport, getCabangList };
