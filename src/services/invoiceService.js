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

  const params = [startDate, endDate];
  let cabangFilter = "";

  // 1. Filter Cabang
  if (cabang === "KDC") {
    // Biarkan kosong untuk melihat semua, atau sesuaikan filter gudang
    cabangFilter = "";
  } else if (cabang) {
    cabangFilter = " AND h.inv_cab = ?";
    params.push(cabang);
  }

  // 2. Filter Status (GUNAKAN LOGIKA DASHBOARD)
  let statusFilterClause = "";
  if (status === "sisa_piutang" || status === "belum_lunas") {
    // Kita cek langsung ke tabel PIUTANG, cocokkan ph_inv_nomor dengan FL.Nomor
    // Ini menjamin data yang muncul SAMA PERSIS dengan count di dashboard
    statusFilterClause = `
      AND EXISTS (
        SELECT 1 
        FROM tpiutang_hdr u
        LEFT JOIN (
            SELECT pd_ph_nomor, SUM(pd_debet) AS debet, SUM(pd_kredit) AS kredit 
            FROM tpiutang_dtl GROUP BY pd_ph_nomor
        ) v ON v.pd_ph_nomor = u.ph_nomor
        WHERE u.ph_inv_nomor = FL.Nomor
          AND u.ph_tanggal BETWEEN '2020-01-01' AND '2100-12-31' -- Cek sepanjang masa (sesuai dashboard)
          AND (IFNULL(v.debet, 0) - IFNULL(v.kredit, 0)) > 100
      )
    `;
  }

  // 3. Query Utama (Tetap gunakan struktur CTE untuk Display Data)
  const query = `
    WITH
    Promo AS (
        SELECT pro_nomor, pro_lipat FROM tpromo
    ),
    DetailCalc AS (
        SELECT 
          d.invd_inv_nomor, d.invd_nourut, d.invd_kode, d.invd_ukuran, d.invd_jumlah, d.invd_harga, d.invd_diskon,
          h.inv_pro_nomor,
          (SELECT pro_lipat FROM Promo p WHERE p.pro_nomor = h.inv_pro_nomor LIMIT 1) AS lipat
        FROM tinv_dtl d
        LEFT JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
    ),
    SumNominal AS (
      SELECT
        dc.invd_inv_nomor,
        ROUND(
          (
            -- 1. Total Harga per Item (Setelah diskon item)
            SUM( (dc.invd_jumlah * dc.invd_harga) - (dc.invd_jumlah * dc.invd_diskon) )
            
            -- 2. Kurangi Diskon Faktur 1 (%)
            * (1 - (COALESCE(h.inv_disc1, 0) / 100)) 
            
            -- 3. Kurangi Diskon Faktur 2 (%)
            * (1 - (COALESCE(h.inv_disc2, 0) / 100))
          )
          -- 4. Kurangi Diskon Faktur (Rupiah Manual)
          - COALESCE(h.inv_disc, 0)
        , 0) AS NominalPiutang
      FROM DetailCalc dc
      LEFT JOIN tinv_hdr h ON h.inv_nomor = dc.invd_inv_nomor
      GROUP BY dc.invd_inv_nomor
    ),
    DPUsed AS (
        SELECT sd.sd_inv AS inv_nomor, SUM(sd.sd_bayar) AS dpDipakai
        FROM tsetor_dtl sd
        WHERE sd.sd_ket = 'DP LINK DARI INV'
        GROUP BY sd.sd_inv
    ),
    MinusCheck AS (
        SELECT 
          d.invd_inv_nomor AS Nomor,
          CASE WHEN SUM(COALESCE(m.mst_stok_in,0) - COALESCE(m.mst_stok_out,0)) < 0 THEN 'Y' ELSE 'N' END AS Minus
        FROM tinv_dtl d
        JOIN tbarangdc b ON b.brg_kode = d.invd_kode
        LEFT JOIN tmasterstok m ON m.mst_brg_kode = d.invd_kode AND m.mst_ukuran = d.invd_ukuran AND m.mst_aktif = 'Y'
        WHERE b.brg_logstok = 'Y'
        GROUP BY d.invd_inv_nomor
    ),
    PiutangReal AS (
        SELECT 
            ph.ph_inv_nomor,
            (SUM(pd.pd_debet) - SUM(pd.pd_kredit)) AS SaldoAkhir
        FROM tpiutang_hdr ph
        JOIN tpiutang_dtl pd ON pd.pd_ph_nomor = ph.ph_nomor
        GROUP BY ph.ph_inv_nomor
    ),
    FinalList AS (
      SELECT 
        h.inv_nomor AS Nomor,
        h.inv_tanggal AS Tanggal,
        IF(h.inv_nomor_so <> "", "", IF(h.inv_rptunai = 0 AND h.inv_nosetor = "", "", IF((SELECT COUNT(*) FROM finance.tjurnal j WHERE j.jur_nomor = h.inv_nomor) <> 0, "SUDAH", IF((SELECT COUNT(*) FROM finance.tjurnal j WHERE j.jur_nomor = h.inv_nosetor AND h.inv_nosetor <> "") <> 0, "SUDAH", "BELUM")))) AS Posting,
        h.inv_nomor_so AS NomorSO,
        o.so_tanggal AS TglSO,
        h.inv_top AS Top,
        DATE_FORMAT(DATE_ADD(h.inv_tanggal, INTERVAL h.inv_top DAY), "%d/%m/%Y") AS Tempo,
        h.inv_disc1 AS \`Dis%\`,
        h.inv_disc AS Diskon,
        h.inv_dp AS Dp,
        h.inv_bkrm AS Biayakirim,
        (
          COALESCE(SN.NominalPiutang,0) 
          + h.inv_ppn 
          + h.inv_bkrm 
          - COALESCE(h.inv_mp_biaya_platform, 0) -- KURANGI BIAYA PLATFORM
        ) AS Nominal,
        (
          COALESCE(SN.NominalPiutang,0) 
          + h.inv_ppn 
          + h.inv_bkrm 
          - COALESCE(h.inv_mp_biaya_platform, 0)
        ) AS Piutang,

        h.inv_mp_nama AS Marketplace,        
        h.inv_mp_nomor_pesanan AS NoPesanan, 
        h.inv_mp_resi AS NoResi,             
        h.inv_mp_biaya_platform AS BiayaPlatform, 
        
        -- BAYAR
        -- Logika: Nominal - SisaPiutang
        (
           (
             COALESCE(SN.NominalPiutang,0) 
             + h.inv_ppn 
             + h.inv_bkrm 
             - COALESCE(h.inv_mp_biaya_platform, 0)
           ) 
           - 
           IF(COALESCE(PR.SaldoAkhir, 0) < 0, 0, 
             COALESCE(PR.SaldoAkhir, 
              (
                 COALESCE(SN.NominalPiutang,0) 
                 + h.inv_ppn 
                 + h.inv_bkrm 
                 - COALESCE(h.inv_mp_biaya_platform, 0)
              )
             )
           )
        ) AS Bayar,

        -- SISA PIUTANG
        -- Logika: Ambil saldo real. Jika negatif (error desktop), anggap 0 (Lunas).
        -- Jika null (belum masuk piutang), anggap sama dengan Nominal Netto.
        IF(COALESCE(PR.SaldoAkhir, 0) < 0, 0, 
           COALESCE(PR.SaldoAkhir, 
            (
               COALESCE(SN.NominalPiutang,0) 
               + h.inv_ppn 
               + h.inv_bkrm 
               - COALESCE(h.inv_mp_biaya_platform, 0)
            )
           )
        ) AS SisaPiutang,

        h.inv_cus_kode AS Kdcus,
        c.cus_nama AS Nama,
        c.cus_alamat AS Alamat,
        c.cus_kota AS Kota,
        c.cus_telp AS Telp,
        CONCAT(h.inv_cus_level, " - ", lvl.level_nama) AS xLevel,
        h.inv_mem_hp AS Hp,
        h.inv_mem_nama AS Member,
        h.inv_ket AS Keterangan,
        h.inv_rptunai AS RpTunai,
        h.inv_novoucher AS NoVoucher,
        h.inv_rpvoucher AS RpVoucher,
        h.inv_rpcard AS RpTransfer,
        h.inv_nosetor AS NoSetoran,
        sh.sh_tgltransfer AS TglTransfer,
        sh.sh_akun AS Akun,
        rek.rek_rekening AS NoRekening,
        h.inv_rj_nomor AS NoRetur,
        h.inv_rj_rp AS RpRetur,
        h.inv_sc AS SC,
        h.inv_print AS Prn,
        h.inv_puas AS Puas,
        h.date_create AS Created,
        h.inv_closing AS Closing,
        h.user_modified AS UserModified,
        h.date_modified AS DateModified
      FROM tinv_hdr h
      LEFT JOIN tso_hdr o ON o.so_nomor = h.inv_nomor_so
      LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
      LEFT JOIN tcustomer_level lvl ON lvl.level_kode = h.inv_cus_level
      LEFT JOIN tsetor_hdr sh ON sh.sh_nomor = h.inv_nosetor
      LEFT JOIN finance.trekening rek ON rek.rek_kode = sh.sh_akun
      LEFT JOIN SumNominal SN ON SN.invd_inv_nomor = h.inv_nomor
      LEFT JOIN PiutangReal PR ON PR.ph_inv_nomor = h.inv_nomor
      LEFT JOIN DPUsed DP ON DP.inv_nomor = h.inv_nomor
      WHERE h.inv_sts_pro = 0
        -- Filter Tanggal Invoice tetap berlaku
        -- Jika ingin melihat SEMUA invoice gantung (tanpa peduli tgl invoice), 
        -- logic statusFilterClause di atas sudah menghandle tgl piutang.
        -- Namun biasanya user tetap ingin filter 'Invoice yang dibuat periode X'
        AND h.inv_tanggal BETWEEN ? AND ? 
        ${cabangFilter}
    )
    SELECT 
        FL.*,
        IFNULL(MC.Minus, 'N') AS Minus,
        (SELECT ii.pd_tanggal 
         FROM tpiutang_dtl ii
         JOIN tpiutang_hdr jj ON jj.ph_nomor = ii.pd_ph_nomor
         WHERE jj.ph_inv_nomor = FL.Nomor
           AND ii.pd_kredit <> 0
         ORDER BY ii.pd_tanggal DESC LIMIT 1) AS LastPayment
    FROM FinalList FL
    LEFT JOIN MinusCheck MC ON MC.Nomor = FL.Nomor
    WHERE 1=1
      ${statusFilterClause} -- FILTER SINKRON DASHBOARD
    ORDER BY FL.Nomor ASC;
  `;

  const [rows] = await pool.query(query, params);
  return rows;
};

const getDetails = async (nomor) => {
  const query = `
    SELECT 
      d.invd_kode AS Kode,
      IFNULL(b.brgd_barcode, "") AS Barcode,
      IF(
        d.invd_pro_nomor = "",
        IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), f.sd_nama),
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna, " #BONUS"))
      ) AS Nama,
      d.invd_ukuran AS Ukuran,
      d.invd_jumlah AS Jumlah,

      -- harga asli per pcs
      d.invd_harga AS HargaAsli,

      -- harga setelah diskon (per pcs)
      CASE
        WHEN (SELECT p.pro_lipat FROM tpromo p WHERE p.pro_nomor = h.inv_pro_nomor LIMIT 1) = 'N'
              AND (
                SELECT COUNT(*) 
                FROM tinv_dtl x 
                WHERE x.invd_inv_nomor = h.inv_nomor 
                  AND x.invd_diskon > 0
                  AND x.invd_nourut < d.invd_nourut
              ) > 0
          THEN d.invd_harga
          ELSE (d.invd_harga - d.invd_diskon)
      END AS Harga,

      -- diskon aktif per pcs
      CASE
        WHEN (SELECT p.pro_lipat FROM tpromo p WHERE p.pro_nomor = h.inv_pro_nomor LIMIT 1) = 'N'
              AND (
                SELECT COUNT(*) 
                FROM tinv_dtl x 
                WHERE x.invd_inv_nomor = h.inv_nomor 
                  AND x.invd_diskon > 0
                  AND x.invd_nourut < d.invd_nourut
              ) > 0
        THEN 0
        ELSE d.invd_diskon
      END AS DiskonAktif,

      -- diskon persentase (asli dari kolom)
      d.invd_disc AS \`Dis%\`,

      -- total nilai item setelah logika diskon
      CASE
        WHEN (SELECT p.pro_lipat FROM tpromo p WHERE p.pro_nomor = h.inv_pro_nomor LIMIT 1) = 'N'
            AND (
              SELECT COUNT(*) 
              FROM tinv_dtl x 
              WHERE x.invd_inv_nomor = h.inv_nomor 
                AND x.invd_diskon > 0
                AND x.invd_nourut < d.invd_nourut
            ) > 0
        THEN (d.invd_jumlah * d.invd_harga)
        ELSE (d.invd_jumlah * (d.invd_harga - d.invd_diskon))
      END AS Total

    FROM tinv_dtl d
    LEFT JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
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
          AND h.inv_cab = ?
        ORDER BY h.inv_nomor, d.invd_nourut;
    `;
  const [rows] = await pool.query(query, [startDate, endDate, cabang]);
  return rows;
};

const checkIfInvoiceInFsk = async (nomorInv) => {
  const query = `
    SELECT 1
    FROM tform_setorkasir_dtl
    WHERE fskd_inv = ?
    LIMIT 1;
  `;
  const [rows] = await pool.query(query, [nomorInv]);
  return rows.length > 0; // true = sudah disetorkan
};

module.exports = {
  getCabangList,
  getList,
  getDetails,
  remove,
  getExportDetails,
  checkIfInvoiceInFsk,
};
