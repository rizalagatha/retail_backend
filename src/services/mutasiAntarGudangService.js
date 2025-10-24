const pool = require("../config/database");
const { format, addMonths, startOfMonth } = require("date-fns");

/**
 * Mengambil daftar header Mutasi Antar Gudang.
 */
const getList = async (filters) => {
  const { startDate, endDate, kodeBarang } = filters;

  let query = `
        SELECT 
            h.mts_nomor AS nomor,
            h.mts_tanggal AS tanggal,
            LEFT(h.mts_nomor, 3) AS dariGudang,
            h.mts_kecab AS keGudang,
            g.gdg_nama AS namaStore,
            h.mts_ket AS keterangan,
            h.mts_stbj AS noSTBJ,
            
            -- --- PERBAIKAN DI SINI ---
            -- 1. Bergabung (JOIN) dengan tbarangdc_dtl untuk mendapatkan HPP
            -- 2. Mengalikan jumlah (mtsd_jumlah) dengan HPP (brgd_hpp)
            SUM(d.mtsd_jumlah * IFNULL(b.brgd_hpp, 0)) AS total,
            -- --- AKHIR PERBAIKAN ---

            (
                SELECT 
                    CASE
                        WHEN pin_acc = "" AND pin_dipakai = "" THEN "WAIT"
                        WHEN pin_acc = "Y" AND pin_dipakai = "" THEN "ACC"
                        WHEN pin_acc = "Y" AND pin_dipakai = "Y" THEN ""
                        WHEN pin_acc = "N" THEN "TOLAK"
                        ELSE ""
                    END
                FROM kencanaprint.tspk_pin5 
                WHERE pin_trs = "MUTASI AG" AND pin_nomor = h.mts_nomor 
                ORDER BY pin_urut DESC 
                LIMIT 1
            ) AS ngedit,
            h.user_create AS usr,
            h.mts_closing AS closing
        FROM retail.tdc_mts_hdr h
        JOIN retail.tdc_mts_dtl d ON d.mtsd_nomor = h.mts_nomor
        LEFT JOIN retail.tgudang g ON g.gdg_kode = h.mts_kecab
        
        -- --- TAMBAHKAN JOIN INI ---
        LEFT JOIN retail.tbarangdc_dtl b ON d.mtsd_kode = b.brgd_kode AND d.mtsd_ukuran = b.brgd_ukuran
        -- -------------------------

        WHERE h.mts_tanggal BETWEEN ? AND ?
    `;
  const params = [startDate, endDate];

  if (kodeBarang) {
    query += " AND d.mtsd_kode = ?";
    params.push(kodeBarang);
  }

  query += " GROUP BY h.mts_nomor ORDER BY h.mts_tanggal";

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Mengambil data detail untuk baris master.
 */
const getDetails = async (nomor) => {
  const query = `
        SELECT 
            d.mtsd_kode AS kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d.mtsd_ukuran AS ukuran,
            d.mtsd_jumlah AS jumlah
        FROM retail.tdc_mts_dtl d
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.mtsd_kode
        WHERE d.mtsd_nomor = ?
        ORDER BY d.mtsd_nomor
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

/**
 * Menghapus data Mutasi Antar Gudang.
 */
const deleteMutasi = async (nomor, user) => {
  // Ambil data untuk validasi
  const [rows] = await pool.query(
    "SELECT mts_nomor, mts_tanggal, mts_stbj, mts_closing FROM retail.tdc_mts_hdr WHERE mts_nomor = ?",
    [nomor]
  );
  if (rows.length === 0) throw new Error("Dokumen tidak ditemukan.");
  const doc = rows[0];

  // Validasi dari Delphi
  if (doc.mts_stbj)
    throw new Error("Mutasi Otomatis dari Terima STBJ. Tidak bisa dihapus.");
  if (doc.mts_closing === "Y")
    throw new Error("Sudah Closing Stok Opname. Tidak bisa dihapus.");

  // TODO: Implementasikan logika ztglclose jika diperlukan
  // const ztglclose = 20; // Ambil dari config
  // const tglDoc = new Date(doc.mts_tanggal);
  // const tglBatas = startOfMonth(addMonths(tglDoc, 1));
  // tglBatas.setDate(ztglclose);
  // if (new Date() > tglBatas) {
  //     throw new Error('Transaksi tsb sudah close. Tidak bisa dihapus.');
  // }

  await pool.query("DELETE FROM retail.tdc_mts_hdr WHERE mts_nomor = ?", [
    nomor,
  ]);
  // Asumsi detail terhapus oleh ON DELETE CASCADE, jika tidak:
  // await pool.query('DELETE FROM retail.tdc_mts_dtl WHERE mtsd_nomor = ?', [nomor]);

  return { message: `Mutasi ${nomor} berhasil dihapus.` };
};

/**
 * Mengajukan perubahan data.
 */
const submitPengajuan = async (nomor, tanggal, keterangan, alasan, user) => {
  const [existing] = await pool.query(
    'SELECT pin_urut, pin_dipakai FROM kencanaprint.tspk_pin5 WHERE pin_trs="MUTASI AG" AND pin_nomor = ? ORDER BY pin_urut DESC LIMIT 1',
    [nomor]
  );

  let urut = 1;
  if (existing.length > 0) {
    urut =
      existing[0].pin_dipakai === ""
        ? existing[0].pin_urut
        : existing[0].pin_urut + 1;
  }

  const query = `
        INSERT INTO kencanaprint.tspk_pin5 
            (pin_trs, pin_nomor, pin_urut, pin_tgl_trs, pin_ket, pin_tgl_minta, pin_user_minta, pin_alasan, pin_acc) 
        VALUES 
            ("MUTASI AG", ?, ?, ?, ?, NOW(), ?, ?, "")
        ON DUPLICATE KEY UPDATE
            pin_tgl_trs = ?,
            pin_ket = ?,
            pin_acc = "",
            pin_tgl_minta = NOW(),
            pin_user_minta = ?,
            pin_alasan = ?
    `;
  const params = [
    nomor,
    urut,
    tanggal,
    keterangan,
    user.kode,
    alasan,
    tanggal,
    keterangan,
    user.kode,
    alasan, // Untuk ON DUPLICATE KEY
  ];

  await pool.query(query, params);
  return { message: "Berhasil diajukan. Menunggu ACC." };
};

/**
 * Mengambil data detail untuk export, berdasarkan filter.
 */
const getExportDetails = async (filters) => {
  const { startDate, endDate, kodeBarang } = filters;

  // Query ini adalah terjemahan dari SQLDetail di Delphi
  let query = `
        SELECT 
            h.mts_nomor AS 'Nomor Mutasi',
            h.mts_tanggal AS 'Tanggal',
            LEFT(h.mts_nomor, 3) AS 'Dari Gudang',
            h.mts_kecab AS 'Ke Gudang',
            g.gdg_nama AS 'Nama Store',
            d.mtsd_kode AS 'Kode Barang',
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS 'Nama Barang',
            d.mtsd_ukuran AS 'Ukuran',
            d.mtsd_jumlah AS 'Jumlah'
        FROM retail.tdc_mts_dtl d
        INNER JOIN retail.tdc_mts_hdr h ON d.mtsd_nomor = h.mts_nomor
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.mtsd_kode
        LEFT JOIN retail.tgudang g ON g.gdg_kode = h.mts_kecab
        WHERE h.mts_tanggal BETWEEN ? AND ?
    `;
  const params = [startDate, endDate];

  if (kodeBarang) {
    query += " AND d.mtsd_kode = ?";
    params.push(kodeBarang);
  }

  query += " ORDER BY h.mts_nomor";

  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getDetails,
  deleteMutasi,
  submitPengajuan,
  getExportDetails,
};
