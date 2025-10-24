const pool = require("../config/database");

/**
 * Mengambil data Laporan Saldo Kasir.
 * Query ini adalah optimasi besar dari alur 'btnExcelClick' di Delphi,
 * menggantikan tabel temporer dan banyak query kecil dengan satu query CTE.
 */
const getList = async (filters, user) => {
  const { startDate, endDate, gudangKode } = filters;

  // Pastikan cabang yang difilter adalah cabang user, kecuali jika user KDC
  const finalGudangKode = user.cabang === "KDC" ? gudangKode : user.cabang;

  const query = `
        WITH
        -- 1. Ambil Setoran Kasir Tunai dari Invoice
        SetoranTunai AS (
            SELECT 
                "SETORAN KASIR TUNAI" AS jenis,
                h.inv_tanggal AS tanggal,
                IF(h.inv_rptunai <= (
                    SELECT (SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) - hh.inv_disc + hh.inv_bkrm + (hh.inv_ppn/100 * (SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) - hh.inv_disc)))
                    FROM tinv_dtl dd LEFT JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor WHERE hh.inv_nomor = h.inv_nomor
                ), h.inv_rptunai, (
                    SELECT (SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) - hh.inv_disc + hh.inv_bkrm + (hh.inv_ppn/100 * (SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) - hh.inv_disc)))
                    FROM tinv_dtl dd LEFT JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor WHERE hh.inv_nomor = h.inv_nomor
                )) AS nominal
            FROM tinv_hdr h
            WHERE LEFT(h.inv_nomor, 3) = ?
              AND h.inv_sts_pro = 0 
              AND h.inv_rptunai <> 0 
              AND h.inv_tanggal BETWEEN ? AND ?
        ),
        -- 2. Ambil Pembayaran Tunai
        PembayaranTunai AS (
            SELECT "PEMBAYARAN TUNAI" AS jenis, h.sh_tanggal AS tanggal, h.sh_nominal AS nominal
            FROM tsetor_hdr h
            WHERE LEFT(h.sh_nomor, 3) = ? AND h.sh_jenis = 0 AND h.sh_tanggal BETWEEN ? AND ?
        ),
        -- 3. Ambil Pembayaran Transfer
        PembayaranTransfer AS (
            SELECT "PEMBAYARAN TRANSFER" AS jenis, h.sh_tanggal AS tanggal, h.sh_nominal AS nominal
            FROM tsetor_hdr h
            WHERE LEFT(h.sh_nomor, 3) = ? AND h.sh_jenis = 1 AND h.sh_tanggal BETWEEN ? AND ?
        ),
        -- 4. Ambil Pembayaran Giro
        PembayaranGiro AS (
            SELECT "PEMBAYARAN GIRO" AS jenis, h.sh_tanggal AS tanggal, h.sh_nominal AS nominal
            FROM tsetor_hdr h
            WHERE LEFT(h.sh_nomor, 3) = ? AND h.sh_jenis = 2 AND h.sh_tanggal BETWEEN ? AND ?
        ),
        -- 5. Gabungkan semua data transaksi
        AllTransactions AS (
            SELECT jenis, tanggal, SUM(nominal) AS nominal FROM SetoranTunai GROUP BY tanggal
            UNION ALL
            SELECT jenis, tanggal, SUM(nominal) AS nominal FROM PembayaranTunai GROUP BY tanggal
            UNION ALL
            SELECT jenis, tanggal, SUM(nominal) AS nominal FROM PembayaranTransfer GROUP BY tanggal
            UNION ALL
            SELECT jenis, tanggal, SUM(nominal) AS nominal FROM PembayaranGiro GROUP BY tanggal
        ),
        -- 6. Ambil data verifikasi
        Verifikasi AS (
            SELECT 
                c.fskd2_jenis AS jenis,
                a.fsk_tanggal AS tanggal,
                a.fsk_tanggalv AS tanggalv,
                SUM(c.fskd2_nominalv) AS nominalv
            FROM tform_setorkasir_hdr a
            LEFT JOIN tform_setorkasir_dtl2 c ON c.fskd2_nomor = a.fsk_nomor
            WHERE LEFT(a.fsk_nomor, 3) = ? AND a.fsk_tanggal BETWEEN ? AND ?
            GROUP BY 1, 2, 3
        )
        -- 7. Query final untuk menggabungkan transaksi dan verifikasi
        SELECT 
            t.jenis AS 'Jenis',
            t.tanggal AS 'Tanggal',
            t.nominal AS 'Nominal',
            v.tanggalv AS 'Tanggal Verifikasi',
            IFNULL(v.nominalv, 0) AS 'Nominal Verifikasi',
            (t.nominal - IFNULL(v.nominalv, 0)) AS 'Saldo',
            IF(v.tanggalv IS NULL, 'BELUM SETOR', '') AS 'Keterangan'
        FROM AllTransactions t
        LEFT JOIN Verifikasi v ON t.jenis = v.jenis AND t.tanggal = v.tanggal
        WHERE t.nominal > 0
        ORDER BY t.jenis DESC, t.tanggal;
    `;

  const params = [
    finalGudangKode,
    startDate,
    endDate, // SetoranTunai
    finalGudangKode,
    startDate,
    endDate, // PembayaranTunai
    finalGudangKode,
    startDate,
    endDate, // PembayaranTransfer
    finalGudangKode,
    startDate,
    endDate, // PembayaranGiro
    finalGudangKode,
    startDate,
    endDate, // Verifikasi
  ];

  const [rows] = await pool.query(query, params);
  return rows;
};

const getGudangOptions = async (user) => {
  let query;
  const params = [];
  if (user.cabang === "KDC") {
    query =
      "SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang ORDER BY gdg_kode";
  } else {
    query =
      "SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode = ?";
    params.push(user.cabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getGudangOptions,
};
