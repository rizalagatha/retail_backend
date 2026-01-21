const pool = require("../config/database");

const getCabangOptions = async (user) => {
  let query = "";
  let params = [];

  // Filter dasar: Tampilkan semua store (biasa dan prioritas)
  let whereClause = "WHERE (gdg_dc = 0 OR gdg_dc = 3)";

  if (user.cabang === "KDC") {
    // Untuk KDC, tambahkan pengecualian
    whereClause += ' AND gdg_kode NOT IN ("KBS", "KPS")';
    query = `SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang ${whereClause} ORDER BY gdg_kode`;
  } else {
    // Untuk user cabang biasa, filter berdasarkan cabangnya sendiri di antara store yang valid
    whereClause += " AND gdg_kode = ?";
    params.push(user.cabang);
    query = `SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang ${whereClause}`;
  }

  const [rows] = await pool.query(query, params);
  return rows;
};

const getList = async (filters, user) => {
  const { startDate, endDate, cabang } = filters;

  let whereClauses = ["h.rj_tanggal BETWEEN ? AND ?"];
  let params = [startDate, endDate];

  if (cabang === "KDC") {
    whereClauses.push(
      "h.rj_cab IN (SELECT gdg_kode FROM tgudang WHERE gdg_dc = 1)",
    );
  } else {
    whereClauses.push("h.rj_cab = ?");
    params.push(cabang);
  }

  const query = `
    SELECT 
        h.rj_nomor AS nomor,
        h.rj_tanggal AS tanggal,
        h.rj_inv AS invoice,
        CASE h.rj_jenis 
          WHEN 'N' THEN 'TUKAR BARANG'
          WHEN 'O' THEN 'RETUR ONLINE'
          ELSE 'SALAH QTY'
        END AS jenis,
        h.rj_ket AS keterangan,
        h.rj_closing AS closing,
        h.rj_cus_kode AS kdCus,
        c.cus_nama AS nama,
        c.cus_alamat AS alamat,
        c.cus_kota AS kota,
        h.user_create AS usr,
        h.date_create AS created,
        /* 1. Hitung Nominal Retur */
        (
            SELECT ROUND(SUM(d.rjd_jumlah*(d.rjd_harga-d.rjd_diskon))-h.rj_disc+(h.rj_ppn/100*(SUM(d.rjd_jumlah*(d.rjd_harga-d.rjd_diskon))-h.rj_disc)))
            FROM trj_dtl d WHERE d.rjd_nomor = h.rj_nomor
        ) AS nominal,

        /* 2. Hitung Dibayarkan: Cek ke tabel Retur DC jika jenis 'O' */
        CASE 
          WHEN h.rj_jenis = 'O' AND EXISTS (SELECT 1 FROM trbdc_hdr WHERE rb_ket LIKE CONCAT('%', h.rj_nomor, '%')) THEN
            (SELECT ROUND(SUM(d.rjd_jumlah*(d.rjd_harga-d.rjd_diskon))-h.rj_disc+(h.rj_ppn/100*(SUM(d.rjd_jumlah*(d.rjd_harga-d.rjd_diskon))-h.rj_disc)))
             FROM trj_dtl d WHERE d.rjd_nomor = h.rj_nomor)
          ELSE IFNULL(p.link, 0)
        END AS diBayarkan,

        /* 3. Hitung Sisa */
        (
          (SELECT ROUND(SUM(d.rjd_jumlah*(d.rjd_harga-d.rjd_diskon))-h.rj_disc+(h.rj_ppn/100*(SUM(d.rjd_jumlah*(d.rjd_harga-d.rjd_diskon))-h.rj_disc)))
           FROM trj_dtl d WHERE d.rjd_nomor = h.rj_nomor) 
          - 
          (CASE 
            WHEN h.rj_jenis = 'O' AND EXISTS (SELECT 1 FROM trbdc_hdr WHERE rb_ket LIKE CONCAT('%', h.rj_nomor, '%')) THEN
              (SELECT ROUND(SUM(d.rjd_jumlah*(d.rjd_harga-d.rjd_diskon))-h.rj_disc+(h.rj_ppn/100*(SUM(d.rjd_jumlah*(d.rjd_harga-d.rjd_diskon))-h.rj_disc)))
               FROM trj_dtl d WHERE d.rjd_nomor = h.rj_nomor)
            ELSE IFNULL(p.link, 0)
          END)
        ) AS sisa

    FROM trj_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.rj_cus_kode
    LEFT JOIN (
        SELECT pd_ket, SUM(pd_kredit) AS link 
        FROM tpiutang_dtl 
        WHERE pd_uraian IN ('Pembayaran Retur', 'Pembayaran Retur Online', 'Retur Online (Adjustment)') 
        GROUP BY pd_ket
    ) p ON p.pd_ket = h.rj_nomor
    WHERE ${whereClauses.join(" AND ")}
    GROUP BY h.rj_nomor
    ORDER BY h.rj_nomor DESC;
    `;
  const [rows] = await pool.query(query, params);
  return rows;
};

const getDetails = async (nomor) => {
  const query = `
    SELECT 
        d.rjd_kode AS kode,
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
        d.rjd_ukuran,
        d.rjd_jumlah AS jumlah,
        d.rjd_harga AS harga,
        d.rjd_disc AS 'discPersen',
        d.rjd_diskon AS diskon,
        (d.rjd_jumlah * (d.rjd_harga - d.rjd_diskon)) AS total
    FROM trj_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.rjd_kode
    WHERE d.rjd_nomor = ?
    ORDER BY d.rjd_nourut;
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

const getPaymentLinks = async (nomor) => {
  const query = `
    SELECT 
        RIGHT(pd_ph_nomor, 17) AS invoice,
        pd_tanggal AS tanggal,
        pd_kredit AS nominal 
    FROM tpiutang_dtl
    WHERE pd_ket = ? AND pd_uraian = 'Pembayaran Retur'
    ORDER BY pd_tanggal;
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

const remove = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [headerRows] = await connection.query(
      `SELECT 
            h.rj_closing, 
            h.rj_cab AS cabang,
            h.rj_idrec,
            IFNULL(p.link, 0) AS diBayarkan
        FROM trj_hdr h
        LEFT JOIN (
        SELECT pd_ket, SUM(pd_kredit) AS link 
            FROM tpiutang_dtl 
            WHERE pd_uraian = 'Pembayaran Retur' 
            GROUP BY pd_ket
        ) p ON p.pd_ket = h.rj_nomor
        WHERE h.rj_nomor = ?`,
      [nomor],
    );

    if (headerRows.length === 0)
      throw new Error("Dokumen retur tidak ditemukan.");
    const header = headerRows[0];

    if (header.diBayarkan > 0)
      throw new Error("Retur ini sudah dilink ke piutang, tidak bisa dihapus.");
    if (header.closing === "Y")
      throw new Error("Sudah Closing, tidak bisa dihapus.");
    if (user.cabang !== "KDC" && header.cabang !== user.cabang)
      throw new Error("Anda tidak berhak menghapus data cabang lain.");

    // Hapus dari trj_hdr dan trj_dtl (via cascade atau manual)
    await connection.query("DELETE FROM trj_dtl WHERE rjd_nomor = ?", [nomor]);
    await connection.query("DELETE FROM trj_hdr WHERE rj_nomor = ?", [nomor]);

    // Hapus juga dari tpiutang_dtl jika ada referensi (sesuai Delphi)
    if (header.rj_idrec) {
      await connection.query(
        "DELETE FROM tpiutang_dtl WHERE pd_sd_angsur = ?",
        [header.rj_idrec],
      );
    }

    await connection.commit();
    return { message: `Retur Jual ${nomor} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getExportDetails = async (filters, user) => {
  // Filters berisi startDate, endDate, cabang dari Frontend
  const { startDate, endDate, cabang } = filters;

  // Gunakan DATE() agar filter mencakup seluruh jam dalam hari tersebut
  let whereClauses = ["DATE(h.rj_tanggal) BETWEEN ? AND ?"];
  let params = [startDate, endDate];

  if (user.cabang === "KDC") {
    // Jika user KDC, dia bisa filter cabang tertentu ATAU defaultnya semua cabang DC
    // Jika filters.cabang ada isinya (bukan ALL/kosong), pakai filter itu
    if (cabang && cabang !== "ALL") {
      whereClauses.push("h.rj_cab = ?");
      params.push(cabang);
    } else {
      // Default KDC melihat semua data DC
      whereClauses.push(
        "h.rj_cab IN (SELECT gdg_kode FROM tgudang WHERE gdg_dc = 1)",
      );
    }
  } else {
    // Jika user cabang biasa, paksa hanya lihat cabangnya sendiri
    whereClauses.push("h.rj_cab = ?");
    params.push(user.cabang);
  }

  const query = `
    SELECT 
        h.rj_nomor AS 'Nomor Retur',
        h.rj_tanggal AS 'Tanggal',
        h.rj_inv AS 'No. Invoice',
        c.cus_nama AS 'Customer',
        d.rjd_kode AS 'Kode Barang',
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS 'Nama Barang',
        d.rjd_ukuran AS 'Ukuran',
        d.rjd_jumlah AS 'Qty Retur',
        d.rjd_harga AS 'Harga',
        d.rjd_diskon AS 'Diskon Rp',
        (d.rjd_jumlah * (d.rjd_harga - d.rjd_diskon)) AS 'Total'
    FROM trj_hdr h
    INNER JOIN trj_dtl d ON h.rj_nomor = d.rjd_nomor
    LEFT JOIN tcustomer c ON c.cus_kode = h.rj_cus_kode
    LEFT JOIN tbarangdc a ON a.brg_kode = d.rjd_kode
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY h.rj_nomor, d.rjd_nourut;
    `;

  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getCabangOptions,
  getList,
  getDetails,
  getPaymentLinks,
  remove,
  getExportDetails,
};
