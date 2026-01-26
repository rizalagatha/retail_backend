const pool = require("../config/database");
const { format } = require("date-fns");

const getOffers = async (startDate, endDate, cabang) => {
  let params = [startDate, endDate];
  let branchFilter = "";

  if (cabang === "KDC") {
    branchFilter =
      "AND h.pen_cab IN (SELECT gdg_kode FROM tgudang WHERE gdg_dc = 1)";
  } else {
    branchFilter = "AND h.pen_cab = ?";
    params.push(cabang);
  }

  const query = `
        SELECT 
            h.pen_nomor AS nomor,
            h.pen_tanggal AS tanggal,
            IFNULL((SELECT so.so_nomor 
                    FROM tso_hdr so 
                    WHERE so.so_pen_nomor = h.pen_nomor 
                    LIMIT 1), '') AS noSO,
            h.pen_top AS top,
            DATE_ADD(h.pen_tanggal, INTERVAL h.pen_top DAY) as tempo,
            h.pen_ppn AS ppn,
            h.pen_disc1 AS \`disc%\`,
            h.pen_disc AS diskon,
            h.pen_cus_kode AS kdcus,
            c.cus_nama AS nama,
            c.cus_alamat AS alamat,
            c.cus_kota AS kota,
            c.cus_telp AS telp,
            CONCAT(h.pen_cus_level, ' - ', l.level_nama) AS level,
            h.pen_ket AS keterangan,
            h.pen_alasan AS alasan,
            h.user_create AS created,
            h.user_modified AS userModified,
            h.date_modified AS dateModified,
            (
                SELECT ROUND(SUM(dd.pend_jumlah * (dd.pend_harga - dd.pend_diskon)) - hh.pen_disc 
                    + (hh.pen_ppn/100 * (SUM(dd.pend_jumlah * (dd.pend_harga - dd.pend_diskon)) - hh.pen_disc)) 
                    + hh.pen_bkrm)
                FROM tpenawaran_dtl dd
                LEFT JOIN tpenawaran_hdr hh ON hh.pen_nomor = dd.pend_nomor
                WHERE hh.pen_nomor = h.pen_nomor
            ) AS nominal,
            h.pen_alasan AS alasanClose,
            (
                SELECT inv.inv_nomor 
                FROM tinv_hdr inv 
                WHERE inv.inv_nomor_so = (
                    SELECT so.so_nomor 
                    FROM tso_hdr so 
                    WHERE so.so_pen_nomor = h.pen_nomor 
                    LIMIT 1
                )
                LIMIT 1
            ) AS noINV
        FROM tpenawaran_hdr h
        LEFT JOIN tcustomer c ON h.pen_cus_kode = c.cus_kode
        LEFT JOIN tcustomer_level l ON l.level_kode = h.pen_cus_level
        WHERE h.pen_tanggal BETWEEN ? AND ?
        ${branchFilter}
    `;

  try {
    const [rows] = await pool.query(query, params);
    return rows;
  } catch (error) {
    console.error("❌ SQL Error:", error.sqlMessage || error.message);
    console.error("❌ SQL Query:", error.sql || query);
    console.error("❌ SQL Params:", params);
    throw error;
  }
};

const getOfferDetails = async (nomor) => {
  const query = `
    SELECT
        d.pend_kode AS kode,
        IFNULL(b.brgd_barcode, "") AS barcode,
        -- Prioritaskan nama custom, lalu nama SO DTF, lalu nama barang reguler
        CASE 
            WHEN d.pend_custom = 'Y' AND NULLIF(d.pend_custom_nama, '') IS NOT NULL 
                THEN d.pend_custom_nama 
            WHEN f.sd_nama IS NOT NULL 
                THEN f.sd_nama
            ELSE IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), "Barang Umum")
        END AS Nama,
        d.pend_ukuran AS ukuran,
        d.pend_jumlah AS qty,
        d.pend_harga AS harga,
        d.pend_diskon AS diskon,
        (d.pend_jumlah * (d.pend_harga - d.pend_diskon)) AS total,
        d.pend_custom,
        d.pend_custom_data
    FROM tpenawaran_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.pend_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.pend_kode AND b.brgd_ukuran = d.pend_ukuran
    LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.pend_sd_nomor
    WHERE d.pend_nomor = ?
    ORDER BY d.pend_nourut;
  `;

  const [rows] = await pool.query(query, [nomor]);

  // Proses ukuran di JavaScript agar kompatibel dengan versi MariaDB lama
  return rows.map((item) => {
    let displayUkuran = item.ukuran;

    if (
      (!displayUkuran || displayUkuran === "") &&
      item.pend_custom === "Y" &&
      item.pend_custom_data
    ) {
      try {
        const customObj =
          typeof item.pend_custom_data === "string"
            ? JSON.parse(item.pend_custom_data)
            : item.pend_custom_data;

        if (customObj.ukuranKaos && Array.isArray(customObj.ukuranKaos)) {
          displayUkuran = [
            ...new Set(customObj.ukuranKaos.map((u) => u.ukuran)),
          ].join(", ");
        }
      } catch (e) {
        console.error("Gagal parse ukuran detail browse:", e);
      }
    }

    return {
      kode: item.kode,
      barcode: item.barcode,
      Nama: item.Nama,
      ukuran: displayUkuran,
      qty: item.qty,
      harga: item.harga,
      diskon: item.diskon,
      total: item.total,
    };
  });
};

const getDataForPrinting = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    // 1. Ambil Header + Customer + Info Jenis Order
    const [headerRows] = await connection.query(
      `
        SELECT h.*, c.cus_nama, c.cus_alamat, c.cus_telp,
               h.pen_jenis_order_nama -- Ambil Nama Jenis Order
        FROM tpenawaran_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
        WHERE h.pen_nomor = ?
    `,
      [nomor],
    );

    if (headerRows.length === 0) return null;
    const header = headerRows[0];

    // 2. Ambil Info Gudang untuk Header Cetakan
    const [gudangRows] = await connection.query(
      `SELECT gdg_inv_nama, gdg_inv_alamat, gdg_inv_kota, gdg_inv_telp, gdg_akun, gdg_transferbank 
       FROM tgudang WHERE gdg_kode = ?`,
      [header.pen_cab],
    );
    const gudang = gudangRows[0];

    // 3. Ambil Detail (Utamakan pend_custom_nama jika ada)
    const [details] = await connection.query(
      `
    SELECT 
        d.pend_kode AS kode, 
        -- Gunakan COALESCE & NULLIF agar jika string kosong tetap lari ke ELSE
        CASE 
            WHEN d.pend_custom = 'Y' AND NULLIF(d.pend_custom_nama, '') IS NOT NULL 
                THEN d.pend_custom_nama 
            WHEN f.sd_nama IS NOT NULL 
                THEN f.sd_nama
            ELSE IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), "Jasa Cetak")
        END AS nama_barang,
        d.pend_ukuran AS ukuran, d.pend_jumlah AS qty, d.pend_harga AS harga,
        d.pend_diskon AS diskon, (d.pend_jumlah * (d.pend_harga - d.pend_diskon)) as total
    FROM tpenawaran_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.pend_kode
    LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.pend_sd_nomor
    WHERE d.pend_nomor = ? 
    ORDER BY d.pend_nourut
`,
      [nomor],
    );

    // 4. Ambil Rincian DP (Uang Muka)
    const [dps] = await connection.query(
      `
        SELECT sk.sh_nomor AS nomor, 
               CASE WHEN sk.sh_jenis = 0 THEN 'TUNAI' WHEN sk.sh_jenis = 1 THEN 'TRANSFER' ELSE 'GIRO' END AS jenis, 
               sk.sh_nominal AS nominal
        FROM tpenawaran_dp link
        JOIN tsetor_hdr sk ON sk.sh_nomor = link.pnd_nomor_dp
        WHERE link.pnd_nomor_pen = ?
    `,
      [nomor],
    );

    // 5. Kalkulasi Total
    const total = details.reduce((sum, item) => sum + Number(item.total), 0);
    const total_dp = dps.reduce((sum, dp) => sum + Number(dp.nominal), 0);

    return {
      header: {
        ...header,
        ...gudang,
        total: total,
        diskon: Number(header.pen_disc || 0),
        ppn: (header.pen_ppn / 100) * (total - Number(header.pen_disc || 0)),
        biaya_kirim: Number(header.pen_bkrm || 0),
        grand_total:
          total -
          Number(header.pen_disc || 0) +
          (header.pen_ppn / 100) * (total - Number(header.pen_disc || 0)) +
          Number(header.pen_bkrm || 0),
        total_dp: total_dp,
        belum_dibayar: total - Number(header.pen_disc || 0) - total_dp,
      },
      details,
      dps: dps || [], // [PENTING] Pastikan selalu mengembalikan array meskipun kosong
    };
  } finally {
    connection.release();
  }
};

const getExportDetails = async (startDate, endDate, cabang) => {
  const query = `
        SELECT 
            h.pen_nomor AS 'Nomor Penawaran',
            h.pen_tanggal AS 'Tanggal',
            h.pen_cus_kode AS 'Kode Customer',
            c.cus_nama AS 'Nama Customer',
            d.pend_kode AS 'Kode Barang',
            IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), f.sd_nama) AS Nama,
            d.pend_ukuran AS 'Ukuran',
            d.pend_jumlah AS 'Qty',
            d.pend_harga AS 'Harga',
            d.pend_diskon AS 'Diskon',
            (d.pend_jumlah * (d.pend_harga - d.pend_diskon)) AS 'Total'
        FROM tpenawaran_hdr h
        JOIN tpenawaran_dtl d ON h.pen_nomor = d.pend_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
        LEFT JOIN tbarangdc a ON a.brg_kode = d.pend_kode
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.pend_kode
        WHERE h.pen_tanggal BETWEEN ? AND ?
        AND h.pen_cab = ?
        ORDER BY h.pen_nomor, d.pend_nourut;
    `;
  const [rows] = await pool.query(query, [startDate, endDate, cabang]);
  return rows;
};

const getBranchOptions = async (userCabang) => {
  let query = "";
  if (userCabang === "KDC") {
    query =
      'SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode NOT IN ("KBS","KPS") ORDER BY gdg_kode';
  } else {
    query = `SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode = '${userCabang}'`;
  }
  const [rows] = await pool.query(query);
  return rows;
};

const closeOffer = async (nomor, alasan) => {
  const query = `
        UPDATE tpenawaran_hdr 
        SET pen_alasan = ? 
        WHERE pen_nomor = ?;
    `;
  await pool.query(query, [alasan, nomor]);
  return { success: true, message: `Penawaran ${nomor} berhasil ditutup.` };
};

const deleteOffer = async (nomor) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Hapus semua item detail terlebih dahulu
    await connection.query("DELETE FROM tpenawaran_dtl WHERE pend_nomor = ?", [
      nomor,
    ]);

    // 2. Hapus header transaksinya
    await connection.query("DELETE FROM tpenawaran_hdr WHERE pen_nomor = ?", [
      nomor,
    ]);

    await connection.commit();
    return { success: true, message: `Penawaran ${nomor} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    console.error("Error deleting offer:", error);
    throw new Error("Gagal menghapus data penawaran.");
  } finally {
    connection.release();
  }
};

module.exports = {
  getOffers,
  getOfferDetails,
  getDataForPrinting,
  getExportDetails,
  getBranchOptions,
  closeOffer,
  deleteOffer,
};
