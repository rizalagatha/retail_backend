// models/potonganModel.js
const pool = require("../config/database"); // Asumsi koneksi database di file ini

// =========================================================================
// UTILITY FUNCTIONS
// =========================================================================

/**
 * Mendapatkan daftar cabang yang dapat diakses oleh pengguna.
 * Logika sama seperti getCabangList Anda.
 */

const getCabangList = async (user) => {
  try {
    let query = "";
    const params = [];

    if (user.cabang === "KDC") {
      // KDC = kantor pusat, bisa lihat semua cabang kecuali KBS dan KPS
      query = `
        SELECT gdg_kode AS kode, gdg_nama AS nama
        FROM tgudang
        WHERE gdg_kode NOT IN ('KBS', 'KPS')
        ORDER BY gdg_kode
      `;
    } else {
      query = `
        SELECT gdg_kode AS kode, gdg_nama AS nama
        FROM tgudang
        WHERE gdg_kode = ?
        ORDER BY gdg_kode
      `;
      params.push(user.cabang);
    }

    const [rows] = await pool.query(query, params);
    return rows;
  } catch (err) {
    console.error("Error in getCabangList:", err.message);
    throw err;
  }
};

/**
 * Mendapatkan nomor potongan (pt_nomor) maksimal berikutnya.
 * Replikasi dari fungsi TfrmPotongan.getmaxnomor.
 * Format: K01.POT.YYMM.NNNN
 */
const getNextPotonganNumber = async (gdgKode, date) => {
  const d = new Date(date);
  const yearMonth =
    String(d.getFullYear()).substring(2) +
    String(d.getMonth() + 1).padStart(2, "0"); // YYMM
  const prefix = `${gdgKode}.POT.${yearMonth}`;

  const sql = `
        SELECT IFNULL(MAX(RIGHT(pt_nomor, 4)), 0) AS max_num
        FROM tpotongan_hdr 
        WHERE LEFT(pt_nomor, 12) = ?
    `;

  const [rows] = await pool.query(sql, [prefix]);
  const maxNum = rows[0].max_num;
  const nextNum = parseInt(maxNum) + 1;

  // Format ke NNNN (e.g., 0001)
  const formattedNextNum = String(nextNum).padStart(4, "0");

  return `${prefix}.${formattedNextNum}`;
};

const getList = async (filters) => {
  try {
    const { startDate, endDate, cabang } = filters;
    const query = `
            SELECT 
                h.pt_nomor AS Nomor,
                h.pt_tanggal AS Tanggal,
                h.pt_nominal AS Nominal,
                h.pt_nominal AS dBayarkan, -- Asumsi dBayarkan dan Nominal sama di list view
                h.pt_nominal AS dSisakan,  -- Asumsi dSisakan adalah field yang tidak ada/diabaikan, atau ini total potongan. Kita set sama dengan Nominal/dBayarkan
                h.pt_akun AS Akun,
                r.rek_nama AS NamaAkun,
                r.rek_rekening AS NoRekening,
                h.pt_cus_kode AS Kdcust, -- Sama dengan customer_kode
                c.cus_nama AS Customer,
                c.cus_alamat AS Alamat,
                c.cus_kota AS Kota,
                h.user_create AS Usr,
                LEFT(h.pt_nomor, 3) AS Cab, -- Ambil kode cabang dari pt_nomor
                -- Pengecekan Jurnal (Closing)
                IF(EXISTS(SELECT 1 FROM finance.tjurnal j WHERE j.jur_nomor = h.pt_nomor), 'Y', 'N') AS Closing
            FROM tpotongan_hdr h
            LEFT JOIN tcustomer c ON c.cus_kode = h.pt_cus_kode
            LEFT JOIN finance.trekening r ON r.rek_kode = h.pt_akun -- Ambil Nama Akun dan No Rekening
            WHERE LEFT(h.pt_nomor, 3) = ? 
                AND h.pt_tanggal BETWEEN ? AND ?
            ORDER BY h.pt_tanggal DESC, h.pt_nomor ASC;
        `;
    const [rows] = await pool.query(query, [cabang, startDate, endDate]);
    return rows;
  } catch (err) {
    console.error("Error in getList:", err.message);
    throw new Error("Gagal mengambil daftar potongan.");
  }
};

/**
 * [READ] Mengambil detail satu Potongan (untuk form Ubah)
 */
const getDetails = async (nomor) => {
  // 1. Ambil data Header
  const headerQuery = `
        SELECT h.*, g.gdg_nama, c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp, r.rek_nama, r.rek_rekening
        FROM tpotongan_hdr h
        LEFT JOIN tgudang g ON g.gdg_kode = LEFT(h.pt_nomor, 3)
        LEFT JOIN tcustomer c ON c.cus_kode = h.pt_cus_kode
        LEFT JOIN finance.trekening r ON r.rek_kode = h.pt_akun
        WHERE h.pt_nomor = ?
    `;
  const [headerRows] = await pool.query(headerQuery, [nomor]);

  if (headerRows.length === 0) return null;

  // 2. Ambil data Detail (Invoice)
  const detailQuery = `
        SELECT 
            d.ptd_tanggal AS tglbayar, d.ptd_inv AS invoice, d.ptd_bayar AS bayar, d.ptd_angsur AS angsur,
            p.ph_tanggal AS tanggal, p.ph_top AS top, 
            p.ph_nominal AS nominal,
            IFNULL(q.mBayar, 0) AS terbayar, 
            (p.ph_nominal - IFNULL(q.mBayar, 0)) AS sisa_piutang
        FROM tpotongan_dtl d
        LEFT JOIN tpiutang_hdr p ON p.ph_inv_nomor = d.ptd_inv
        LEFT JOIN (
            -- Total Kredit (Pembayaran) termasuk Potongan lain yang sudah dijurnal/diproses
            SELECT pd_ph_nomor, SUM(pd_kredit) mBayar FROM tpiutang_dtl GROUP BY pd_ph_nomor
        ) q ON q.pd_ph_nomor = CONCAT(headerRows[0].pt_cus_kode, p.ph_inv_nomor)
        WHERE d.ptd_nomor = ?
        ORDER BY d.ptd_angsur
    `;
  const [detailRows] = await pool.query(detailQuery, [nomor]);

  // Cek apakah sudah dijurnal untuk menentukan tombol edit aktif atau tidak
  const [jurnalCheck] = await pool.query(
    "SELECT jur_nomor FROM finance.tjurnal WHERE jur_nomor = ? LIMIT 1",
    [nomor]
  );

  return {
    header: headerRows[0],
    details: detailRows,
    isJurnalled: jurnalCheck.length > 0, // Tambahkan status jurnal
  };
};

/**
 * [CREATE/UPDATE] Menyimpan atau Mengubah data Potongan
 * Replikasi dari TfrmPotongan.simpandata.
 */
const save = async (data, user) => {
  const { header, details, isEdit } = data;
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    let ptNomor = header.pt_nomor;
    const ptTanggal = header.pt_tanggal;
    const ptNominal = parseFloat(header.pt_nominal) || 0;
    const ptAkun = header.pt_akun;
    const ptCusKode = header.pt_cus_kode;
    const cabKode = header.cabang_kode || user.cabang; // Ambil dari header/user
    const userKode = user.kode; // Asumsi user.kode adalah KDUSER

    // --- VALIDASI AWAL (Minimal) ---
    if (!ptCusKode || ptNominal === 0) {
      throw new Error("Customer dan Nominal Potongan harus diisi.");
    }

    // 1. INSERT/UPDATE Header
    if (!isEdit || !ptNomor) {
      // INSERT (Baru)
      ptNomor = await getNextPotonganNumber(cabKode, ptTanggal);

      const insertHdrSql = `
                INSERT INTO tpotongan_hdr 
                (pt_nomor, pt_cus_kode, pt_tanggal, pt_akun, pt_nominal, user_cab, user_create, date_create)
                VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
            `;
      await connection.query(insertHdrSql, [
        ptNomor,
        ptCusKode,
        ptTanggal,
        ptAkun,
        ptNominal,
        cabKode,
        userKode,
      ]);
    } else {
      // UPDATE (Ubah)
      const updateHdrSql = `
                UPDATE tpotongan_hdr SET
                pt_tanggal = ?, pt_nominal = ?, pt_akun = ?,
                user_modified = ?, date_modified = NOW()
                WHERE pt_nomor = ?
            `;
      await connection.query(updateHdrSql, [
        ptTanggal,
        ptNominal,
        ptAkun,
        userKode,
        ptNomor,
      ]);

      // Hapus Detail Lama sebelum insert yang baru
      await connection.query("DELETE FROM tpotongan_dtl WHERE ptd_nomor = ?", [
        ptNomor,
      ]);
      // Hapus tpiutang_dtl yang merujuk pada potongan ini (pd_ket = nomor potongan)
      await connection.query("DELETE FROM tpiutang_dtl WHERE pd_ket = ?", [
        ptNomor,
      ]);
    }

    // 2. INSERT Detail dan tpiutang_dtl
    for (const detail of details) {
      const bayar = parseFloat(detail.bayar) || 0;
      if (detail.invoice && bayar > 0) {
        // Generate angsuran ID (mirip cAngsur Delphi)
        const angsuran =
          detail.angsur ||
          `${cabKode}POT${new Date()
            .toISOString()
            .replace(/\D/g, "")
            .slice(2, 17)}`;

        // INSERT tpotongan_dtl
        const insertDtlSql = `
                    INSERT INTO tpotongan_dtl 
                    (ptd_nomor, ptd_tanggal, ptd_inv, ptd_bayar, ptd_angsur) 
                    VALUES (?, ?, ?, ?, ?)
                `;
        await connection.query(insertDtlSql, [
          ptNomor,
          detail.tglbayar,
          detail.invoice,
          bayar,
          angsuran,
        ]);

        // INSERT tpiutang_dtl (Piutang Kredit/Potongan)
        const insertPiutangDtlSql = `
                    INSERT INTO tpiutang_dtl 
                    (pd_ph_nomor, pd_tanggal, pd_uraian, pd_kredit, pd_ket, pd_sd_angsur) 
                    VALUES (?, ?, 'Potongan', ?, ?, ?)
                `;
        // pd_ph_nomor = cus_kode + invoice
        const pdPhNomor = ptCusKode + detail.invoice;
        await connection.query(insertPiutangDtlSql, [
          pdPhNomor,
          detail.tglbayar,
          bayar,
          ptNomor,
          angsuran,
        ]);
      }
    }

    // Catatan: Sinkronisasi file/batch (ShellExecute) diabaikan karena ini adalah server web.
    // Logika sinkronisasi harus ditangani oleh service atau proses terpisah di infrastruktur baru.

    await connection.commit();
    return { message: "Data potongan berhasil disimpan.", nomor: ptNomor };
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

/**
 * [DELETE] Menghapus data Potongan
 */
const remove = async (nomor, user) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Cek Validasi
    const [rows] = await connection.query(
      `
            SELECT user_cab FROM tpotongan_hdr WHERE pt_nomor = ?
        `,
      [nomor]
    );

    if (rows.length === 0) throw new Error("Data Potongan tidak ditemukan.");
    const potongan = rows[0];

    // Cek Cabang
    if (potongan.user_cab !== user.cabang && user.cabang !== "KDC") {
      throw new Error(
        `Anda tidak berhak menghapus data milik cabang ${potongan.user_cab}.`
      );
    }

    // Cek Jurnal
    const [jurnalCheck] = await connection.query(
      "SELECT jur_nomor FROM finance.tjurnal WHERE jur_nomor = ? LIMIT 1",
      [nomor]
    );
    if (jurnalCheck.length > 0) {
      throw new Error("Transaksi sudah dijurnal. Tidak bisa dihapus.");
    }

    // 2. Hapus Transaksi (Rollback order penting)
    await connection.query("DELETE FROM tpotongan_dtl WHERE ptd_nomor = ?", [
      nomor,
    ]);
    await connection.query("DELETE FROM tpiutang_dtl WHERE pd_ket = ?", [
      nomor,
    ]); // pd_ket adalah nomor potongan
    await connection.query("DELETE FROM tpotongan_hdr WHERE pt_nomor = ?", [
      nomor,
    ]);

    await connection.commit();
    return { message: `Potongan ${nomor} berhasil dihapus.` };
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

/**
 * [EXPORT] Mengambil detail untuk Export
 */
const getExportDetails = async (filters) => {
  const { startDate, endDate, cabang } = filters;
  const query = `
        SELECT
            h.pt_nomor AS 'Nomor Potongan',
            h.pt_tanggal AS 'Tanggal Potongan',
            c.cus_nama AS 'Nama Customer',
            h.pt_nominal AS 'Total Potongan',
            d.ptd_inv AS 'Invoice',
            d.ptd_bayar AS 'Nominal Potongan Invoice',
            d.ptd_angsur AS 'Nomor Angsuran',
            h.user_create AS 'Dibuat Oleh'
        FROM tpotongan_hdr h
        JOIN tpotongan_dtl d ON h.pt_nomor = d.ptd_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = h.pt_cus_kode
        WHERE LEFT(h.pt_nomor, 3) = ? 
            AND h.pt_tanggal BETWEEN ? AND ?
        ORDER BY h.pt_nomor, d.ptd_inv;
    `;
  const [rows] = await pool.query(query, [cabang, startDate, endDate]);
  return rows;
};

/**
 * [READ] Mengambil detail invoice untuk expanded row di browse.
 * Ini adalah versi ringan dari getDetails.
 */
const getBrowseDetails = async (nomor) => {
  try {
    // Ambil customer code dari header dulu
    const [hdr] = await pool.query(
      "SELECT pt_cus_kode FROM tpotongan_hdr WHERE pt_nomor = ?",
      [nomor]
    );
    if (hdr.length === 0) {
      return []; // Tidak ada header, return array kosong
    }
    const ptCusKode = hdr[0].pt_cus_kode;

    // Query ini sama dengan 'detailQuery' di 'getDetails'
    const detailQuery = `
      SELECT 
        d.ptd_tanggal AS tglbayar, d.ptd_inv AS invoice, d.ptd_bayar AS bayar, d.ptd_angsur AS angsur,
        p.ph_tanggal AS tanggal, p.ph_top AS top, 
        p.ph_nominal AS nominal,
        IFNULL(q.mBayar, 0) AS terbayar, 
        (p.ph_nominal - IFNULL(q.mBayar, 0)) AS sisa_piutang
      FROM tpotongan_dtl d
      LEFT JOIN tpiutang_hdr p ON p.ph_inv_nomor = d.ptd_inv
      LEFT JOIN (
        SELECT pd_ph_nomor, SUM(pd_kredit) mBayar FROM tpiutang_dtl GROUP BY pd_ph_nomor
      ) q ON q.pd_ph_nomor = CONCAT(?, p.ph_inv_nomor) -- Gunakan ptCusKode dari header
      WHERE d.ptd_nomor = ?
      ORDER BY d.ptd_angsur
    `;
    const [detailRows] = await pool.query(detailQuery, [ptCusKode, nomor]);
    return detailRows;
  } catch (err) {
    console.error("Error in getBrowseDetails:", err.message);
    throw new Error("Gagal mengambil detail potongan.");
  }
};

module.exports = {
  getCabangList,
  getList,
  getDetails,
  save,
  remove,
  getExportDetails,
  getNextPotonganNumber,
  getBrowseDetails,
};
