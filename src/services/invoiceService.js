const pool = require("../config/database");
const { format } = require("date-fns");

const toSqlDateTime = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return format(d, "yyyy-MM-dd HH:mm:ss");
};

// helper: format ke MySQL DATE (yyyy-MM-dd)
const toSqlDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return format(d, "yyyy-MM-dd");
};

const generateNewSetorNumber = async (connection, cabang, tanggal) => {
  const date = new Date(tanggal);
  const prefix = `${cabang}.STR.${format(date, "yyMM")}.`;
  const query = `
    SELECT IFNULL(MAX(RIGHT(sh_nomor, 4)), 0) + 1 AS next_num
    FROM tsetor_hdr 
    WHERE sh_nomor LIKE ?;
  `;
  // Gunakan koneksi dari transaksi agar konsisten
  const [rows] = await connection.query(query, [`${prefix}%`]);
  const nextNumber = rows[0].next_num.toString().padStart(4, "0");
  return `${prefix}${nextNumber}`;
};

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

  // Params awal untuk Filter Tanggal di CTE Utama
  const params = [startDate, endDate];

  // 1. Filter Cabang (Disiapkan untuk disuntikkan ke CTE)
  let cabangFilter = "";
  if (cabang && cabang !== "KDC") {
    cabangFilter = " AND h.inv_cab = ?";
    params.push(cabang);
  }

  // 2. Filter Status (Sisa Piutang / Belum Lunas)
  // Kita pindahkan logika ini agar lebih efisien, tapi tetap di WHERE akhir
  let statusFilterClause = "";
  if (status === "sisa_piutang" || status === "belum_lunas") {
    statusFilterClause = `
      AND (
        COALESCE(PR.SaldoAkhir, 0) > 100 -- Cek langsung dari hasil Join PiutangReal
      )
    `;
  }

  // 3. Query Utama (Optimized)
  // Perubahan: Kita buat CTE "FilteredInvoices" di awal untuk memperkecil scope data.
  const query = `
    WITH 
    -- [OPTIMASI 1] Filter dulu Header Invoice sesuai Tanggal & Cabang
    -- Semua perhitungan di bawah hanya akan memproses ID yang ada di sini.
    FilteredInvoices AS (
        SELECT h.inv_nomor, h.inv_pro_nomor, h.inv_disc
        FROM tinv_hdr h
        WHERE h.inv_sts_pro = 0
          AND h.inv_tanggal BETWEEN ? AND ?
          ${cabangFilter}
    ),

    -- [OPTIMASI 2] Hitung Detail hanya untuk Invoice yang terpilih
    DetailCalc AS (
        SELECT 
          d.invd_inv_nomor,
          -- Logika Promo Lipat langsung di sini
          IFNULL(p.pro_lipat, 'N') as pro_lipat,
          SUM(
             (d.invd_jumlah * d.invd_harga) - (d.invd_jumlah * d.invd_diskon)
          ) as TotalItemNetto
        FROM tinv_dtl d
        INNER JOIN FilteredInvoices fi ON fi.inv_nomor = d.invd_inv_nomor
        LEFT JOIN tpromo p ON p.pro_nomor = fi.inv_pro_nomor
        GROUP BY d.invd_inv_nomor
    ),

    -- [OPTIMASI 3] Hitung DP Terpakai hanya untuk Invoice terpilih
    DPUsed AS (
        SELECT sd.sd_inv, SUM(sd.sd_bayar) AS dpDipakai
        FROM tsetor_dtl sd
        INNER JOIN FilteredInvoices fi ON fi.inv_nomor = sd.sd_inv
        WHERE sd.sd_ket = 'DP LINK DARI INV'
        GROUP BY sd.sd_inv
    ),

    -- [OPTIMASI 4] Cek Minus Stok (Ini yang biasanya paling berat)
    -- Kita batasi join hanya ke barang yang ada di invoice terpilih
    MinusCheck AS (
        SELECT 
          d.invd_inv_nomor AS Nomor,
          'Y' AS Minus
        FROM tinv_dtl d
        INNER JOIN FilteredInvoices fi ON fi.inv_nomor = d.invd_inv_nomor
        JOIN tbarangdc b ON b.brg_kode = d.invd_kode
        LEFT JOIN tmasterstok m ON m.mst_brg_kode = d.invd_kode 
             AND m.mst_ukuran = d.invd_ukuran 
             AND m.mst_aktif = 'Y'
        WHERE b.brg_logstok = 'Y'
        GROUP BY d.invd_inv_nomor
        HAVING SUM(COALESCE(m.mst_stok_in,0) - COALESCE(m.mst_stok_out,0)) < 0
    ),

    -- [OPTIMASI 5] Hitung Sisa Piutang Real hanya untuk Invoice terpilih
    PiutangReal AS (
        SELECT 
            ph.ph_inv_nomor,
            (SUM(pd.pd_debet) - SUM(pd.pd_kredit)) AS SaldoAkhir
        FROM tpiutang_hdr ph
        INNER JOIN FilteredInvoices fi ON fi.inv_nomor = ph.ph_inv_nomor
        JOIN tpiutang_dtl pd ON pd.pd_ph_nomor = ph.ph_nomor
        GROUP BY ph.ph_inv_nomor
    )

    -- QUERY UTAMA: Join kan Header asli dengan hasil kalkulasi di atas
    SELECT 
        h.inv_nomor AS Nomor,
        h.inv_tanggal AS Tanggal,
        
        -- Cek Posting Jurnal (Subquery ini biasanya cepat jika jur_nomor di-index)
        CASE 
            WHEN h.inv_nomor_so <> "" THEN ""
            WHEN h.inv_rptunai = 0 AND h.inv_nosetor = "" THEN ""
            WHEN EXISTS (SELECT 1 FROM finance.tjurnal j WHERE j.jur_nomor = h.inv_nomor) THEN "SUDAH"
            WHEN h.inv_nosetor <> "" AND EXISTS (SELECT 1 FROM finance.tjurnal j WHERE j.jur_nomor = h.inv_nosetor) THEN "SUDAH"
            ELSE "BELUM"
        END AS Posting,

        h.inv_nomor_so AS NomorSO,
        o.so_tanggal AS TglSO,
        h.inv_top AS Top,
        DATE_FORMAT(DATE_ADD(h.inv_tanggal, INTERVAL h.inv_top DAY), "%d/%m/%Y") AS Tempo,
        h.inv_disc1 AS \`Dis%\`,
        h.inv_disc AS Diskon,
        h.inv_dp AS Dp,
        h.inv_bkrm AS Biayakirim,

        -- Kalkulasi Nominal
        (COALESCE(DC.TotalItemNetto, 0) - COALESCE(h.inv_disc, 0) + h.inv_ppn + h.inv_bkrm - COALESCE(h.inv_mp_biaya_platform, 0)) AS Nominal,
        (COALESCE(DC.TotalItemNetto, 0) - COALESCE(h.inv_disc, 0) + h.inv_ppn + h.inv_bkrm - COALESCE(h.inv_mp_biaya_platform, 0)) AS Piutang,

        h.inv_mp_nama AS Marketplace,
        h.inv_mp_nomor_pesanan AS NoPesanan, 
        h.inv_mp_resi AS NoResi, 
        h.inv_mp_biaya_platform AS BiayaPlatform,

        -- Kalkulasi Bayar (Nominal - Sisa)
        (
          (COALESCE(DC.TotalItemNetto, 0) - COALESCE(h.inv_disc, 0) + h.inv_ppn + h.inv_bkrm - COALESCE(h.inv_mp_biaya_platform, 0)) 
          - 
          IF(COALESCE(PR.SaldoAkhir, 0) < 0, 0, COALESCE(PR.SaldoAkhir, (COALESCE(DC.TotalItemNetto, 0) - COALESCE(h.inv_disc, 0) + h.inv_ppn + h.inv_bkrm - COALESCE(h.inv_mp_biaya_platform, 0))))
        ) AS Bayar,

        -- Sisa Piutang Logic
        IF(COALESCE(PR.SaldoAkhir, 0) < 0, 0, 
           COALESCE(PR.SaldoAkhir, 
             (COALESCE(DC.TotalItemNetto, 0) - COALESCE(h.inv_disc, 0) + h.inv_ppn + h.inv_bkrm - COALESCE(h.inv_mp_biaya_platform, 0))
           )
        ) AS SisaPiutang,

        h.inv_cus_kode AS Kdcus,
        COALESCE(k.kar_nama, c.cus_nama, 'KARYAWAN (Cek NIK)') AS Customer,
        COALESCE(k.kar_alamat, c.cus_alamat, '') AS Alamat,
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
        h.date_modified AS DateModified,
        
        -- Info Tambahan
        IFNULL(MC.Minus, 'N') AS Minus,
        (SELECT ii.pd_tanggal 
         FROM tpiutang_dtl ii 
         JOIN tpiutang_hdr jj ON jj.ph_nomor = ii.pd_ph_nomor 
         WHERE jj.ph_inv_nomor = h.inv_nomor AND ii.pd_kredit <> 0 
         ORDER BY ii.pd_tanggal DESC LIMIT 1
        ) AS LastPayment

    FROM tinv_hdr h
    -- Join hanya ke invoice yang sudah difilter di awal (FilteredInvoices)
    -- Ini memaksa MySQL menggunakan index tanggal
    INNER JOIN FilteredInvoices fi ON fi.inv_nomor = h.inv_nomor

    LEFT JOIN tso_hdr o ON o.so_nomor = h.inv_nomor_so
    LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
    LEFT JOIN hrd2.karyawan k ON k.kar_nik = h.inv_cus_kode
    LEFT JOIN tcustomer_level lvl ON lvl.level_kode = h.inv_cus_level
    LEFT JOIN tsetor_hdr sh ON sh.sh_nomor = h.inv_nosetor
    LEFT JOIN finance.trekening rek ON rek.rek_kode = sh.sh_akun
    
    -- Join Hasil CTE
    LEFT JOIN DetailCalc DC ON DC.invd_inv_nomor = h.inv_nomor
    LEFT JOIN PiutangReal PR ON PR.ph_inv_nomor = h.inv_nomor
    LEFT JOIN DPUsed DP ON DP.sd_inv = h.inv_nomor
    LEFT JOIN MinusCheck MC ON MC.Nomor = h.inv_nomor

    WHERE 1=1 
      ${statusFilterClause}
    ORDER BY h.inv_tanggal DESC, h.inv_nomor DESC;
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

  // Logika Filter Cabang (sesuaikan jika perlu logic khusus untuk 'ALL' atau 'KDC')
  let branchFilter = "AND h.inv_cab = ?";
  let params = [startDate, endDate, cabang];

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
          -- [PERBAIKAN] Gunakan DATE() agar jam diabaikan
          AND DATE(h.inv_tanggal) BETWEEN ? AND ?
          ${branchFilter}
        ORDER BY h.inv_nomor, d.invd_nourut;
    `;

  const [rows] = await pool.query(query, params);
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

const changePaymentMethod = async (payload, user) => {
  const { nomor, metodeBaru, bank, noRek, alasan } = payload;
  const connection = await pool.getConnection();

  try {
    // 1. Validasi Invoice
    const [invRows] = await connection.query(
      `SELECT inv_nomor, inv_tanggal, inv_cus_kode, inv_bayar, inv_dp 
       FROM tinv_hdr WHERE inv_nomor = ?`,
      [nomor]
    );

    if (invRows.length === 0) throw new Error("Invoice tidak ditemukan.");
    const inv = invRows[0];

    // 2. Cek Lock FSK (Form Setor Kasir)
    const [fskRows] = await connection.query(
      "SELECT 1 FROM tform_setorkasir_dtl WHERE fskd_inv = ? LIMIT 1",
      [nomor]
    );
    if (fskRows.length > 0) {
      throw new Error(
        "Invoice sudah disetor (FSK). Tidak bisa ubah pembayaran."
      );
    }

    await connection.beginTransaction();

    // =========================================================
    // STEP A: BERSIHKAN DATA LAMA (ANTI-DOUBLE)
    // =========================================================

    // 1. Hapus Setoran Lama (Non-DP)
    const [oldSetor] = await connection.query(
      `SELECT sd_sh_nomor FROM tsetor_dtl 
       WHERE sd_inv = ? AND sd_ket = 'PEMBAYARAN DARI KASIR'`,
      [nomor]
    );

    if (oldSetor.length > 0) {
      const listSetor = oldSetor.map((r) => r.sd_sh_nomor);
      // Hapus Detail Setoran
      await connection.query(
        "DELETE FROM tsetor_dtl WHERE sd_sh_nomor IN (?)",
        [listSetor]
      );
      // Hapus Header Setoran
      await connection.query("DELETE FROM tsetor_hdr WHERE sh_nomor IN (?)", [
        listSetor,
      ]);
    }

    // 2. Hapus History Piutang (Kredit/Pelunasan)
    // Hapus baris pelunasan Tunai/Card/Voucher agar tidak duplikat saldo
    const piutangNomor = `${inv.inv_cus_kode}${nomor}`;
    await connection.query(
      `DELETE FROM tpiutang_dtl 
       WHERE pd_ph_nomor = ? 
         AND pd_uraian IN ('Bayar Tunai Langsung', 'Pembayaran Card', 'Bayar Voucher')`,
      [piutangNomor]
    );

    // =========================================================
    // STEP B: BUAT DATA BARU
    // =========================================================

    // Asumsi: inv_bayar adalah total uang masuk (DP + Pelunasan).
    // Nominal pelunasan hari ini = inv_bayar - inv_dp
    // Namun untuk simplifikasi "Ubah Metode", kita anggap inv_bayar adalah nilai yang valid.
    // Jika sistem Anda memisah DP dan Pelunasan, gunakan logika: (inv.inv_bayar - inv.inv_dp).
    // Di sini saya pakai inv_bayar penuh sebagai nilai transaksi pembayaran (karena biasanya ubah metode = ubah pelunasan).
    // TAPI LEBIH AMAN: Kita anggap nominal yang diubah adalah SISA TAGIHANNYA.
    // Jika inv_dp ada, maka yang dibayar tunai/transfer adalah sisanya.

    let nominalBayar = Number(inv.inv_bayar) - Number(inv.inv_dp || 0);
    if (nominalBayar <= 0) nominalBayar = Number(inv.inv_bayar); // Jaga-jaga jika DP null

    // Reset kolom di Header Invoice
    let updateHdrSql = `
      UPDATE tinv_hdr SET 
        inv_rptunai = 0, inv_rpcard = 0, inv_rpvoucher = 0, inv_nosetor = '', 
        inv_ket = CONCAT(inv_ket, ' | Ubah Bayar: ', ?), -- Tambahkan alasan ke ket (opsional)
        user_modified = ?, date_modified = NOW() 
    `;
    let updateParams = [alasan, user.kode];

    let jenisSetor = 0;
    let nomorSetoranBaru = "";

    // Generate ID Unik untuk record baru
    const timestampID = format(new Date(), "yyyyMMddHHmmss");
    const idrec = `${user.cabang}CHG${timestampID}`;
    const tglSql = toSqlDateTime(inv.inv_tanggal);

    if (metodeBaru === "TUNAI") {
      // --- KASUS TUNAI ---
      updateHdrSql += ", inv_rptunai = ? ";
      updateParams.push(nominalBayar);
      jenisSetor = 0;

      // Catat di Kartu Piutang (Lunas Tunai)
      await connection.query(
        `INSERT INTO tpiutang_dtl (pd_ph_nomor, pd_tanggal, pd_uraian, pd_kredit, pd_ket, pd_sd_angsur)
         VALUES (?, ?, 'Bayar Tunai Langsung', ?, ?, ?)`,
        [piutangNomor, tglSql, nominalBayar, `Ubah ke Tunai (${alasan})`, idrec]
      );
    } else {
      // --- KASUS TRANSFER / EDC ---
      updateHdrSql += ", inv_rpcard = ?, inv_nosetor = ? ";
      jenisSetor = 1;

      // Generate No Setoran Baru
      // Pastikan fungsi generateNewSetorNumber ada di scope ini atau di-import
      nomorSetoranBaru = await generateNewSetorNumber(
        connection,
        user.cabang,
        inv.inv_tanggal
      );
      updateParams.push(nominalBayar, nomorSetoranBaru);

      // 1. Insert tsetor_hdr
      await connection.query(
        `INSERT INTO tsetor_hdr (
           sh_idrec, sh_nomor, sh_cus_kode, sh_tanggal, sh_jenis, sh_nominal, 
           sh_akun, sh_norek, sh_otomatis, user_create, date_create
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Y', ?, NOW())`,
        [
          idrec,
          nomorSetoranBaru,
          inv.inv_cus_kode,
          tglSql,
          jenisSetor,
          nominalBayar,
          bank?.kode || "",
          noRek || "",
          user.kode,
        ]
      );

      // 2. Insert tsetor_dtl (Link Invoice ke Setoran)
      await connection.query(
        `INSERT INTO tsetor_dtl (
           sd_idrec, sd_sh_nomor, sd_tanggal, sd_inv, sd_bayar, sd_ket, sd_angsur, sd_nourut
         ) VALUES (?, ?, ?, ?, ?, 'PEMBAYARAN DARI KASIR', ?, 1)`,
        [idrec, nomorSetoranBaru, tglSql, nomor, nominalBayar, idrec]
      );

      // 3. Insert tpiutang_dtl (Pelunasan via Transfer)
      await connection.query(
        `INSERT INTO tpiutang_dtl (pd_ph_nomor, pd_tanggal, pd_uraian, pd_kredit, pd_ket, pd_sd_angsur)
         VALUES (?, ?, 'Pembayaran Card', ?, ?, ?)`,
        [piutangNomor, tglSql, nominalBayar, nomorSetoranBaru, idrec]
      );
    }

    // Eksekusi Update Header
    updateHdrSql += " WHERE inv_nomor = ?";
    updateParams.push(nomor);
    await connection.query(updateHdrSql, updateParams);

    await connection.commit();
    return { message: "Metode pembayaran berhasil diubah." };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  getCabangList,
  getList,
  getDetails,
  remove,
  getExportDetails,
  checkIfInvoiceInFsk,
  changePaymentMethod,
};
