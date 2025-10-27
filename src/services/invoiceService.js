const pool = require("../config/database");

const getCabangList = async (user) => {
  let query = "";
  const params = [];
  if (user.cabang === "KDC") {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang ORDER BY gdg_kode";
  } else {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ? ORDER BY gdg_kode";
    params.push(user.cabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

const getList = async (filters) => {
  const { startDate, endDate, cabang, status } = filters;
  const params = [startDate, endDate, cabang];

  let statusFilter = "";

  if (status === "belum_lunas") {
    // 'x' adalah alias query luar Anda.
    // Logika ini (SisaPiutang > 0) harus cocok dengan query Anda.
    statusFilter = " AND x.SisaPiutang > 0";
  }

  // Ini adalah terjemahan langsung dari query kompleks di Delphi
  const query = `
        SELECT 
            x.Nomor, x.Tanggal, x.Posting,
            ${cabang === "KPR" ? "x.NomorSJ, x.TglSJ," : "x.NomorSO, x.TglSO,"}
            x.Top, x.Tempo,
            (SELECT ii.pd_tanggal FROM tpiutang_hdr jj
             LEFT JOIN tpiutang_dtl ii ON ii.pd_ph_nomor=jj.ph_nomor
             WHERE ii.pd_kredit<>0 AND jj.ph_inv_nomor=x.Nomor
             ORDER BY ii.pd_tanggal DESC LIMIT 1) AS LastPayment,
            x.inv_disc1 AS \`Dis%\`, x.Diskon, x.Dp, x.Biayakirim, x.Nominal, 
            x.Piutang, x.Bayar, x.SisaPiutang,
            x.Kdcus, x.Nama, x.Alamat, x.Kota, x.Telp, x.xLevel AS \`Level\`, 
            x.Hp, x.Member, x.Keterangan,
            x.inv_rptunai AS RpTunai, x.inv_novoucher AS NoVoucher, 
            x.inv_rpvoucher AS RpVoucher, x.inv_rpcard AS RpTransfer, x.NoSetoran, 
            x.sh_tgltransfer AS TglTransfer, x.sh_akun AS Akun, x.rek_rekening AS NoRekening,
            x.RpRetur, x.NoRetur,
            x.SC, x.Created, x.Prn, x.Puas, x.Closing
        FROM (
            SELECT 
                h.inv_nomor AS Nomor, h.inv_tanggal AS Tanggal,
                IF(h.inv_nomor_so <> "", "",
                    IF(h.inv_rptunai = 0 AND h.inv_nosetor = "", "",
                        IF((SELECT COUNT(*) FROM finance.tjurnal j WHERE j.jur_nomor = h.inv_nomor) <> 0, "SUDAH",
                            IF((SELECT COUNT(*) FROM finance.tjurnal j WHERE j.jur_nomor = h.inv_nosetor AND h.inv_nosetor <> "") <> 0, "SUDAH", "BELUM")
                        )
                    )
                ) AS posting,
                h.inv_nomor_so AS NomorSO,
                o.so_tanggal AS TglSO,
                h.inv_top AS Top,
                DATE_FORMAT(DATE_ADD(h.inv_tanggal, INTERVAL h.inv_top DAY), "%d/%m/%Y") AS Tempo,
                h.inv_ppn AS ppn, h.inv_disc1, h.inv_disc AS Diskon, h.inv_dp AS Dp,
                h.inv_bkrm AS Biayakirim,
                (SELECT ROUND(SUM(dd.invd_jumlah*(dd.invd_harga-dd.invd_diskon))-hh.inv_disc+(inv_ppn/100*(SUM(dd.invd_jumlah*(dd.invd_harga-dd.invd_diskon))-hh.inv_disc))) FROM tinv_dtl dd LEFT JOIN tinv_hdr hh ON hh.inv_nomor=dd.invd_inv_nomor WHERE hh.inv_nomor = h.inv_nomor GROUP BY hh.inv_nomor) AS Nominal,
                u.ph_nominal AS Piutang,
                v.kredit AS Bayar,
                (v.debet - v.kredit) AS SisaPiutang,
                h.inv_cus_kode AS kdcus, s.cus_nama AS Nama, s.cus_alamat AS Alamat, s.cus_kota AS Kota, s.cus_telp AS Telp,
                CONCAT(h.inv_cus_level, " - ", l.level_nama) AS xLevel,
                h.inv_mem_hp AS HP, h.inv_mem_nama AS Member,
                h.inv_ket AS Keterangan, h.inv_rptunai, h.inv_novoucher, h.inv_rpvoucher, h.inv_rj_rp AS RpRetur, h.inv_rj_nomor AS NoRetur,
                h.inv_rpcard, h.inv_nosetor AS NoSetoran, t.sh_tgltransfer, t.sh_akun, r.rek_rekening, h.inv_print AS Prn, h.inv_puas AS Puas, h.inv_sc AS SC, h.date_create AS Created, h.inv_closing AS Closing
            FROM tinv_hdr h
            LEFT JOIN tso_hdr o ON o.so_nomor = h.inv_nomor_so
            LEFT JOIN tcustomer s ON s.cus_kode = h.inv_cus_kode
            LEFT JOIN tcustomer_level l ON l.level_kode = h.inv_cus_level
            LEFT JOIN tsetor_hdr t ON t.sh_nomor = h.inv_nosetor
            LEFT JOIN tpiutang_hdr u ON u.ph_inv_nomor = h.inv_nomor AND u.ph_cus_kode = h.inv_cus_kode
            LEFT JOIN (SELECT pd_ph_nomor, SUM(pd_debet) AS debet, SUM(pd_kredit) AS kredit FROM tpiutang_dtl GROUP BY pd_ph_nomor) v ON v.pd_ph_nomor = u.ph_nomor
            LEFT JOIN finance.trekening r ON r.rek_kode = t.sh_akun
            WHERE h.inv_sts_pro = 0 
              AND h.inv_tanggal BETWEEN ? AND ?
              AND LEFT(h.inv_nomor, 3) = ?
        ) x 
        WHERE 1=1 ${statusFilter}
        ORDER BY x.Nomor ASC;
    `;
  const [rows] = await pool.query(query, params);
  return rows;
};

const getDetails = async (nomor) => {
  const query = `
        SELECT 
            d.invd_kode AS Kode,
            IFNULL(b.brgd_barcode, "") AS Barcode,
            IF(d.invd_pro_nomor = "",
                IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), f.sd_nama),
                TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna, " #BONUS"))
            ) AS Nama,
            d.invd_ukuran AS Ukuran,
            d.invd_jumlah AS Jumlah,
            d.invd_harga AS Harga,
            d.invd_disc AS \`Dis%\`,
            (d.invd_jumlah * (d.invd_harga - d.invd_diskon)) AS Total
        FROM tinv_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.invd_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.invd_kode AND b.brgd_ukuran = d.invd_ukuran
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.invd_kode
        WHERE d.invd_inv_nomor = ?
        ORDER BY d.invd_nourut;
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

const remove = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `
            SELECT h.inv_nomor_so, h.inv_closing,
                   (SELECT COUNT(*) FROM tsetor_dtl WHERE sd_inv = h.inv_nomor AND TRIM(sd_ket) NOT IN ("DP LINK DARI INV","PEMBAYARAN DARI KASIR")) AS payment_count,
                   (SELECT COUNT(*) FROM finance.tjurnal WHERE jur_nomor = h.inv_nomor) AS posting_count
            FROM tinv_hdr h WHERE h.inv_nomor = ?
        `,
      [nomor]
    );

    if (rows.length === 0) throw new Error("Data tidak ditemukan.");
    const invoice = rows[0];

    if (invoice.payment_count > 0)
      throw new Error("Invoice ini sudah ada setoran pembayaran.");
    if (invoice.posting_count > 0)
      throw new Error("Invoice ini sudah di Posting oleh Finance.");
    if (nomor.substring(0, 3) !== user.cabang && user.cabang !== "KDC")
      throw new Error("Anda tidak berhak menghapus data milik cabang lain.");
    if (invoice.inv_closing === "Y") throw new Error("Sudah Closing.");

    await connection.query("DELETE FROM tinv_hdr WHERE inv_nomor = ?", [nomor]);

    await connection.commit();
    return { message: `Invoice ${nomor} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getExportDetails = async (filters) => {
  const { startDate, endDate, cabang } = filters;
  const query = `
        SELECT 
            h.inv_nomor AS 'Nomor Invoice',
            h.inv_tanggal AS 'Tanggal',
            h.inv_nomor_so AS 'Nomor SO',
            c.cus_nama AS 'Customer',
            d.invd_kode AS 'Kode Barang',
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS 'Nama Barang',
            d.invd_ukuran AS 'Ukuran',
            d.invd_jumlah AS 'Jumlah',
            d.invd_harga AS 'Harga',
            d.invd_diskon AS 'Diskon Rp',
            (d.invd_jumlah * (d.invd_harga - d.invd_diskon)) AS 'Total'
        FROM tinv_hdr h
        JOIN tinv_dtl d ON h.inv_nomor = d.invd_inv_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
        LEFT JOIN tbarangdc a ON a.brg_kode = d.invd_kode
        WHERE h.inv_sts_pro = 0
          AND h.inv_tanggal BETWEEN ? AND ?
          AND LEFT(h.inv_nomor, 3) = ?
        ORDER BY h.inv_nomor, d.invd_nourut;
    `;
  const [rows] = await pool.query(query, [startDate, endDate, cabang]);
  return rows;
};

module.exports = {
  getCabangList,
  getList,
  getDetails,
  remove,
  getExportDetails,
};
