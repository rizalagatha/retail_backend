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
    // KDC: Ambil semua daftar toko
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang ORDER BY gdg_kode";
  } else {
    // Cabang: Hanya ambil tokonya sendiri
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ? ORDER BY gdg_kode";
    params.push(user.cabang);
  }

  const [rows] = await pool.query(query, params);

  // [BARU] Jika user adalah KDC, tambahkan opsi "Semua Cabang" di urutan pertama
  if (user.cabang === "KDC") {
    return [{ kode: "ALL", nama: "Semua Cabang" }, ...rows];
  }

  return rows;
};

const getList = async (filters) => {
  const {
    startDate,
    endDate,
    cabang,
    status,
    page = 1,
    limit = 50,
    search,
    columnFilters, // Parameter filter custom dari frontend
  } = filters;

  const offset = (page - 1) * limit;
  const startDateTime = `${startDate} 00:00:00`;
  const endDateTime = `${endDate} 23:59:59`;
  const params = [startDateTime, endDateTime];

  // 1. Filter Cabang
  let cabangFilter = "";

  // Tambahkan pengecekan: cabang !== "ALL"
  let cab = (cabang || "").toUpperCase().trim();

  if (cab && cab !== "KDC" && cab !== "ALL") {
    cabangFilter = " AND h.inv_cab = ?";
    params.push(cab);
  }

  // 2. Global Search (Tetap ada)
  let searchFilter = "";
  if (search) {
    searchFilter = `
      AND (
        h.inv_nomor LIKE ? OR 
        c.cus_nama LIKE ? OR 
        h.inv_cus_kode LIKE ? OR
        h.inv_nomor_so LIKE ?
      )
    `;
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  // 3. [PENTING] Dynamic Column Filters (Excel-Style)
  let dynamicFilter = "";

  if (columnFilters) {
    try {
      const filtersObj = JSON.parse(columnFilters);

      // === MAPPING LENGKAP FIELD FRONTEND KE DATABASE ===
      // Key sebelah kiri harus SAMA PERSIS dengan 'key' di headers frontend
      const fieldMap = {
        // -- Header Utama --
        Nomor: "h.inv_nomor",
        Tanggal: "h.inv_tanggal", // Bisa difilter by date string
        Posting: `(CASE 
                      WHEN EXISTS (SELECT 1 FROM finance.tjurnal j WHERE j.jur_nomor = h.inv_nomor) THEN 'SUDAH' 
                      ELSE 'BELUM' 
                    END)`, // Filter posting agak berat (subquery), tapi bisa
        NomorSO: "h.inv_nomor_so",
        TglSO: "o.so_tanggal",
        Top: "h.inv_top",

        // -- Keuangan --
        Diskon: "h.inv_disc",
        Dp: "h.inv_dp",
        Biayakirim: "h.inv_bkrm",
        RpRetur: "h.inv_rj_rp", // <--- RETUR
        NoRetur: "h.inv_rj_nomor",

        // -- Customer --
        Kdcus: "h.inv_cus_kode",
        Customer: "COALESCE(k.kar_nama, c.cus_nama)",
        Nama: "COALESCE(k.kar_nama, c.cus_nama)",
        Alamat: "COALESCE(k.kar_alamat, c.cus_alamat)",
        Kota: "c.cus_kota",
        Telp: "c.cus_telp",
        Hp: "h.inv_mem_hp",
        Member: "h.inv_mem_nama",
        Level: "lvl.level_nama", // <--- LEVEL

        // -- Pembayaran --
        RpTunai: "h.inv_rptunai", // <--- TUNAI
        RpVoucher: "h.inv_rpvoucher",
        RpTransfer: "h.inv_rpcard",
        NoVoucher: "h.inv_novoucher",
        NoSetoran: "h.inv_nosetor",
        NoRekening: "rek.rek_rekening", // <--- REKENING (Butuh Join)
        Akun: "sh.sh_akun",
        TglTransfer: "sh.sh_tgltransfer",

        // -- Status & System --
        SC: "h.inv_sc",
        Keterangan: "h.inv_ket",
        Created: "h.date_create",
        UserModified: "h.user_modified",
        DateModified: "h.date_modified",
        Prn: "h.inv_print", // <--- PRINT
        Puas: "h.inv_puas",
        Closing: "h.inv_closing", // <--- CLOSING

        // -- Marketplace --
        Marketplace: "h.inv_mp_nama",
        NoPesanan: "h.inv_mp_nomor_pesanan",
        NoResi: "h.inv_mp_resi",
      };

      for (const [key, filter] of Object.entries(filtersObj)) {
        let dbField = fieldMap[key];

        // Fallback: Jika filter tidak ada di map, abaikan agar tidak error SQL
        if (!dbField) continue;

        // A. Multi Select (Checkbox banyak)
        if (
          filter.type === "multi" &&
          Array.isArray(filter.values) &&
          filter.values.length > 0
        ) {
          const placeholders = filter.values.map(() => "?").join(",");
          dynamicFilter += ` AND ${dbField} IN (${placeholders}) `;
          params.push(...filter.values);
        }

        // B. Custom Filter (Input Text / Comparison)
        else if (
          filter.type === "custom" &&
          filter.operator &&
          filter.value !== undefined
        ) {
          const val = filter.value;

          switch (filter.operator) {
            case "=":
              dynamicFilter += ` AND ${dbField} = ? `;
              params.push(val);
              break;
            case "!=":
              dynamicFilter += ` AND ${dbField} <> ? `;
              params.push(val);
              break;
            case "contains":
              dynamicFilter += ` AND ${dbField} LIKE ? `;
              params.push(`%${val}%`);
              break;
            case "starts":
              dynamicFilter += ` AND ${dbField} LIKE ? `;
              params.push(`${val}%`);
              break;
            case "ends":
              dynamicFilter += ` AND ${dbField} LIKE ? `;
              params.push(`%${val}`);
              break;
            case ">":
              dynamicFilter += ` AND ${dbField} > ? `;
              params.push(val);
              break;
            case ">=":
              dynamicFilter += ` AND ${dbField} >= ? `;
              params.push(val);
              break;
            case "<":
              dynamicFilter += ` AND ${dbField} < ? `;
              params.push(val);
              break;
            case "<=":
              dynamicFilter += ` AND ${dbField} <= ? `;
              params.push(val);
              break;
          }
        }
      }
    } catch (e) {
      console.error("Error parsing column filters:", e);
    }
  }

  // 4. Status Filter Clause (Sisa Piutang)
  // Ini tetap di layer paling luar karena butuh perhitungan complex
  let piutangSubQuery = "";
  if (status === "sisa_piutang" || status === "belum_lunas") {
    // Logika: Cari invoice yang ada di tabel piutang DAN saldo akhirnya > 100
    // Menggunakan EXISTS dengan korelasi langsung ke h.inv_nomor
    piutangSubQuery = `
      AND EXISTS (
        SELECT 1 
        FROM tpiutang_hdr ph
        LEFT JOIN (
            SELECT pd_ph_nomor, SUM(pd_debet) as debet, SUM(pd_kredit) as kredit
            FROM tpiutang_dtl
            GROUP BY pd_ph_nomor
        ) pd ON pd.pd_ph_nomor = ph.ph_nomor
        WHERE ph.ph_inv_nomor = h.inv_nomor
        AND (IFNULL(pd.debet, 0) - IFNULL(pd.kredit, 0)) > 100
      )
    `;
  }

  const query = `
    WITH 
    -- [STEP 1] Pagination CTE
    -- DI SINI KITA LAKUKAN JOIN AGAR FILTER BISA JALAN SEBELUM DI-LIMIT
    PagedInvoices AS (
        SELECT h.inv_nomor
        FROM tinv_hdr h
        -- Join Customer & Karyawan (Untuk filter Nama)
        LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
        LEFT JOIN hrd2.karyawan k ON k.kar_nik = h.inv_cus_kode
        LEFT JOIN tcustomer_level lvl ON lvl.level_kode = h.inv_cus_level
        
        -- Join SO (Untuk Tgl SO)
        LEFT JOIN tso_hdr o ON o.so_nomor = h.inv_nomor_so
        
        -- Join Pembayaran (Untuk filter Rekening, Akun, Tgl Transfer)
        LEFT JOIN tsetor_hdr sh ON sh.sh_nomor = h.inv_nosetor
        LEFT JOIN finance.trekening rek ON rek.rek_kode = sh.sh_akun

        WHERE h.inv_sts_pro = 0
          AND h.inv_tanggal BETWEEN ? AND ?
          ${cabangFilter}
          ${searchFilter}
          ${dynamicFilter}  -- <--- Filter Kolom disuntikkan di sini
          ${piutangSubQuery}
        ORDER BY h.inv_tanggal DESC, h.inv_nomor DESC
        LIMIT ? OFFSET ? 
    ),

    -- [STEP 2] Ambil Data Lengkap (Sama seperti sebelumnya)
    FilteredInvoices AS (
        SELECT h.* FROM tinv_hdr h
        INNER JOIN PagedInvoices pi ON pi.inv_nomor = h.inv_nomor
    ),

    -- [STEP 3] Detail Calc (Hitung Total Item)
    DetailCalc AS (
        SELECT 
          d.invd_inv_nomor,
          -- Netto item (Sudah dipotong diskon baris)
          SUM((d.invd_jumlah * d.invd_harga) - (d.invd_jumlah * d.invd_diskon)) as TotalItemNetto,
          -- Akumulasi potongan harga per item
          SUM(d.invd_jumlah * d.invd_diskon) as TotalItemDiscount
        FROM tinv_dtl d
        INNER JOIN PagedInvoices pi ON pi.inv_nomor = d.invd_inv_nomor
        GROUP BY d.invd_inv_nomor
    ),

    -- [STEP 4] Piutang Real (Hitung Saldo)
    PiutangReal AS (
        SELECT 
            ph.ph_inv_nomor,
            (SUM(pd.pd_debet) - SUM(pd.pd_kredit)) AS SaldoAkhir,
            -- Hitung kredit HANYA yang berupa uang (bukan adjustment retur)
            SUM(CASE 
                WHEN pd.pd_uraian NOT LIKE 'Retur Online%' 
                 AND pd.pd_uraian <> 'Pembayaran Retur'
                THEN pd.pd_kredit ELSE 0 END) AS TotalBayarUang
        FROM tpiutang_hdr ph
        INNER JOIN PagedInvoices pi ON pi.inv_nomor = ph.ph_inv_nomor
        JOIN tpiutang_dtl pd ON pd.pd_ph_nomor = ph.ph_nomor
        GROUP BY ph.ph_inv_nomor
    ),

    -- [STEP 5] Minus Check
    MinusCheck AS (
        SELECT 
          d.invd_inv_nomor AS Nomor,
          'Y' AS Minus
        FROM tinv_dtl d
        INNER JOIN PagedInvoices pi ON pi.inv_nomor = d.invd_inv_nomor
        JOIN tbarangdc b ON b.brg_kode = d.invd_kode
        LEFT JOIN tmasterstok m ON m.mst_brg_kode = d.invd_kode 
             AND m.mst_ukuran = d.invd_ukuran 
             AND m.mst_aktif = 'Y'
        WHERE b.brg_logstok = 'Y'
        GROUP BY d.invd_inv_nomor
        HAVING SUM(COALESCE(m.mst_stok_in,0) - COALESCE(m.mst_stok_out,0)) < 0
    )

    -- [STEP 6] SELECT FINAL (Output ke Frontend)
    SELECT 
        h.inv_nomor AS Nomor,
        h.inv_tanggal AS Tanggal,
        
        -- Logic Posting
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
        (COALESCE(DC.TotalItemDiscount, 0) + COALESCE(h.inv_disc, 0)) AS Diskon,
        h.inv_dp AS Dp,
        h.inv_bkrm AS Biayakirim,

        -- [LOGIC NOMINAL]
        (COALESCE(DC.TotalItemNetto, 0) - COALESCE(h.inv_disc, 0) + h.inv_ppn + h.inv_bkrm - COALESCE(h.inv_mp_biaya_platform, 0)) AS Nominal,
        
        -- [LOGIC PIUTANG]
        (COALESCE(DC.TotalItemNetto, 0) - COALESCE(h.inv_disc, 0) + h.inv_ppn + h.inv_bkrm - COALESCE(h.inv_mp_biaya_platform, 0)) AS Piutang,

        h.inv_mp_nama AS Marketplace,
        h.inv_mp_nomor_pesanan AS NoPesanan, 
        h.inv_mp_resi AS NoResi, 
        h.inv_mp_biaya_platform AS BiayaPlatform,

        -- [LOGIC BAYAR]
        -- Jangan gunakan (Total - Sisa) agar tidak salah saat Retur.
        -- Langsung ambil jumlah uang yang dibayarkan di kartu piutang.
        COALESCE(PR.TotalBayarUang, 0) AS Bayar,

        -- [LOGIC SISA PIUTANG] (Tetap, agar sisa jadi 0)
        IF(COALESCE(PR.SaldoAkhir, 0) < 0, 0, 
           COALESCE(PR.SaldoAkhir, (COALESCE(DC.TotalItemNetto, 0) - COALESCE(h.inv_disc, 0) + h.inv_ppn + h.inv_bkrm - COALESCE(h.inv_mp_biaya_platform, 0)))
        ) AS SisaPiutang,

        -- Customer Info
        h.inv_cus_kode AS Kdcus,
        COALESCE(k.kar_nama, c.cus_nama, 'KARYAWAN (Cek NIK)') AS Customer,
        COALESCE(k.kar_alamat, c.cus_alamat, '') AS Alamat,
        c.cus_kota AS Kota,
        c.cus_telp AS Telp,
        CONCAT(h.inv_cus_level, " - ", IFNULL(lvl.level_nama, '')) AS xLevel,
        
        h.inv_mem_hp AS Hp,
        h.inv_mem_nama AS Member,
        
        -- System Info
        h.inv_ket AS Keterangan,
        h.inv_rptunai AS RpTunai,
        h.inv_novoucher AS NoVoucher,
        h.inv_rpvoucher AS RpVoucher,
        h.inv_rpcard AS RpTransfer,
        h.inv_nosetor AS NoSetoran,
        
        sh.sh_tgltransfer AS TglTransfer,
        sh.sh_akun AS Akun,
        rek.rek_rekening AS NoRekening,
        rek.rek_nama AS NamaBank,

        h.inv_rj_nomor AS NoRetur,
        h.inv_rj_rp AS RpRetur,

        h.inv_sc AS SC,
        h.inv_print AS Prn,
        h.inv_puas AS Puas,
        h.date_create AS Created, 
        h.inv_closing AS Closing,
        h.user_modified AS UserModified,
        h.date_modified AS DateModified,
        
        IFNULL(MC.Minus, 'N') AS Minus,
        (SELECT ii.pd_tanggal FROM tpiutang_dtl ii JOIN tpiutang_hdr jj ON jj.ph_nomor = ii.pd_ph_nomor WHERE jj.ph_inv_nomor = h.inv_nomor AND ii.pd_kredit <> 0 ORDER BY ii.pd_tanggal DESC LIMIT 1) AS LastPayment

    FROM FilteredInvoices h
    -- JOIN UTAMA (Untuk Output Final)
    LEFT JOIN tso_hdr o ON o.so_nomor = h.inv_nomor_so
    LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
    LEFT JOIN hrd2.karyawan k ON k.kar_nik = h.inv_cus_kode
    LEFT JOIN tcustomer_level lvl ON lvl.level_kode = h.inv_cus_level
    LEFT JOIN tsetor_hdr sh ON sh.sh_nomor = h.inv_nosetor
    LEFT JOIN finance.trekening rek ON rek.rek_kode = sh.sh_akun
    
    -- JOIN CTE CALCULATIONS
    LEFT JOIN DetailCalc DC ON DC.invd_inv_nomor = h.inv_nomor
    LEFT JOIN PiutangReal PR ON PR.ph_inv_nomor = h.inv_nomor
    LEFT JOIN MinusCheck MC ON MC.Nomor = h.inv_nomor
    
    WHERE 1=1
    ORDER BY h.inv_tanggal DESC, h.inv_nomor DESC;
  `;

  // Push params
  params.push(parseInt(limit), parseInt(offset));

  const [rows] = await pool.query(query, params);

  // --- QUERY TOTAL (Untuk Pagination) ---
  // Kita harus duplicate logic JOIN PagedInvoices agar filter COUNT akurat
  const countQuery = `
    SELECT COUNT(*) as total 
    FROM tinv_hdr h 
    LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
    LEFT JOIN hrd2.karyawan k ON k.kar_nik = h.inv_cus_kode
    LEFT JOIN tcustomer_level lvl ON lvl.level_kode = h.inv_cus_level
    LEFT JOIN tso_hdr o ON o.so_nomor = h.inv_nomor_so
    LEFT JOIN tsetor_hdr sh ON sh.sh_nomor = h.inv_nosetor
    LEFT JOIN finance.trekening rek ON rek.rek_kode = sh.sh_akun
    WHERE h.inv_sts_pro = 0 
      AND h.inv_tanggal BETWEEN ? AND ?
      ${cabangFilter}
      ${searchFilter}
      ${dynamicFilter}
      ${piutangSubQuery}
  `;

  // Params untuk count (buang 2 terakhir: limit & offset)
  const countParams = params.slice(0, params.length - 2);
  const [countRows] = await pool.query(countQuery, countParams);

  return {
    data: rows,
    total: countRows[0].total,
  };
};

const getDetails = async (nomor) => {
  const query = `
    SELECT 
      -- 1. Deteksi apakah invd_kode adalah barcode (kasus klerek)
      -- Jika ada di tbarangdc_dtl.brgd_barcode, gunakan brgd_kode aslinya.
      COALESCE(bk.brgd_kode, d.invd_kode) AS Kode,
      
      -- 2. Ambil Barcode yang benar
      -- Jika data klerek, barcode-nya ada di invd_kode. Jika reguler, ambil dari b.
      IFNULL(bk.brgd_barcode, b.brgd_barcode) AS Barcode,

      IF(
        d.invd_pro_nomor = "",
        IFNULL(
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), 
            f.sd_nama
        ),
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna, " #BONUS"))
      ) AS Nama,

      -- 3. Ambil Ukuran
      -- Pada klerek, kolom invd_ukuran sering kosong, jadi kita ambil dari detail barcode
      COALESCE(NULLIF(d.invd_ukuran, ''), bk.brgd_ukuran) AS Ukuran,

      d.invd_jumlah AS Jumlah,
      d.invd_harga AS HargaAsli,

      -- Logika Harga, Diskon, dan Total tetap sama, tapi join-nya diperbaiki
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

      d.invd_disc AS \`Dis%\`,

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
    
    -- [PENTING] Join khusus untuk mendeteksi barcode (klerek)
    LEFT JOIN tbarangdc_dtl bk ON bk.brgd_barcode = d.invd_kode
    
    -- Gunakan COALESCE agar join ke tabel barang selalu menggunakan KODE asli, bukan barcode
    LEFT JOIN tbarangdc a ON a.brg_kode = COALESCE(bk.brgd_kode, d.invd_kode)
    
    -- Join detail reguler juga menggunakan kode hasil deteksi
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = COALESCE(bk.brgd_kode, d.invd_kode) 
         AND b.brgd_ukuran = COALESCE(NULLIF(d.invd_ukuran, ''), bk.brgd_ukuran)
         
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
      [nomor],
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

const getExportHeader = async (filters) => {
  const { startDate, endDate, cabang, status, search, columnFilters } = filters;

  // [PENTING] Jangan ambil variable 'page' atau 'limit' di sini.
  // Kita ingin ambil SEMUA data.

  // [SETUP PARAMS] Tambahkan jam agar index tanggal terbaca optimal & akurat
  const startDateTime = `${startDate} 00:00:00`;
  const endDateTime = `${endDate} 23:59:59`;
  const params = [startDateTime, endDateTime];

  // 1. Filter Cabang
  let cabangFilter = "";
  if (cabang && cabang !== "KDC" && cabang !== "ALL") {
    cabangFilter = " AND h.inv_cab = ?";
    params.push(cabang);
  }

  // 2. Global Search
  let searchFilter = "";
  if (search) {
    searchFilter = `
      AND (
        h.inv_nomor LIKE ? OR 
        c.cus_nama LIKE ? OR 
        h.inv_cus_kode LIKE ? OR
        h.inv_nomor_so LIKE ?
      )
    `;
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  // 3. Dynamic Column Filters
  let dynamicFilter = "";
  if (columnFilters) {
    try {
      const filtersObj = JSON.parse(columnFilters);
      // Mapping field disederhanakan untuk header
      const fieldMap = {
        Nomor: "h.inv_nomor",
        Customer: "c.cus_nama",
        Kdcus: "h.inv_cus_kode",
        NomorSO: "h.inv_nomor_so",
      };

      for (const [key, filter] of Object.entries(filtersObj)) {
        let dbField = fieldMap[key];
        if (!dbField) continue;
        if (filter.type === "multi" && filter.values?.length) {
          dynamicFilter += ` AND ${dbField} IN (${filter.values
            .map(() => "?")
            .join(",")}) `;
          params.push(...filter.values);
        } else if (filter.type === "custom" && filter.value !== undefined) {
          const val = filter.value;
          switch (filter.operator) {
            case "=":
              dynamicFilter += ` AND ${dbField} = ? `;
              params.push(val);
              break;
            case "contains":
              dynamicFilter += ` AND ${dbField} LIKE ? `;
              params.push(`%${val}%`);
              break;
          }
        }
      }
    } catch (e) {}
  }

  // 4. Status Filter Clause (Sisa Piutang)
  let piutangSubQuery = "";
  if (status === "sisa_piutang" || status === "belum_lunas") {
    piutangSubQuery = `
      AND EXISTS (
        SELECT 1 FROM tpiutang_hdr ph
        LEFT JOIN (
            SELECT pd_ph_nomor, SUM(pd_debet) as debet, SUM(pd_kredit) as kredit
            FROM tpiutang_dtl GROUP BY pd_ph_nomor
        ) pd ON pd.pd_ph_nomor = ph.ph_nomor
        WHERE ph.ph_inv_nomor = h.inv_nomor
        AND (IFNULL(pd.debet, 0) - IFNULL(pd.kredit, 0)) > 100
      )
    `;
  }

  // 5. Query Utama (CTE)
  // [FIX] Hapus LIMIT ? OFFSET ? di dalam PagedInvoices dan ganti nama CTE biar tidak bingung
  const query = `
    WITH 
    BaseInvoices AS (
        SELECT h.inv_nomor
        FROM tinv_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
        LEFT JOIN hrd2.karyawan k ON k.kar_nik = h.inv_cus_kode
        LEFT JOIN tso_hdr o ON o.so_nomor = h.inv_nomor_so
        WHERE h.inv_sts_pro = 0
          -- Gunakan format DateTime lengkap agar index jalan
          AND h.inv_tanggal BETWEEN ? AND ?
          ${cabangFilter}
          ${searchFilter}
          ${dynamicFilter}
          ${piutangSubQuery}
        -- [PENTING] TIDAK ADA LIMIT DI SINI
    ),

    -- Hitung Total Item
    DetailCalc AS (
        SELECT d.invd_inv_nomor,
          SUM((d.invd_jumlah * d.invd_harga) - (d.invd_jumlah * d.invd_diskon)) as TotalItemNetto
        FROM tinv_dtl d
        INNER JOIN BaseInvoices fb ON fb.inv_nomor = d.invd_inv_nomor
        GROUP BY d.invd_inv_nomor
    ),

    -- Hitung Saldo Piutang
    PiutangReal AS (
        SELECT ph.ph_inv_nomor, (SUM(pd.pd_debet) - SUM(pd.pd_kredit)) AS SaldoAkhir
        FROM tpiutang_hdr ph
        INNER JOIN BaseInvoices fb ON fb.inv_nomor = ph.ph_inv_nomor
        JOIN tpiutang_dtl pd ON pd.pd_ph_nomor = ph.ph_nomor
        GROUP BY ph.ph_inv_nomor
    )

    SELECT 
        h.inv_nomor AS 'Nomor',
        DATE_FORMAT(h.inv_tanggal, '%Y-%m-%d') AS 'Tanggal',
        h.inv_nomor_so AS 'Nomor SO',
        DATE_FORMAT(o.so_tanggal, '%Y-%m-%d') AS 'Tgl SO',
        h.inv_top AS 'TOP',
        DATE_FORMAT(DATE_ADD(h.inv_tanggal, INTERVAL h.inv_top DAY), '%Y-%m-%d') AS 'Jatuh Tempo',
        
        -- Customer
        h.inv_cus_kode AS 'Kode Customer',
        COALESCE(k.kar_nama, c.cus_nama, 'KARYAWAN') AS 'Nama Customer',
        c.cus_kota AS 'Kota',

        -- Keuangan
        h.inv_disc AS 'Diskon',
        h.inv_dp AS 'DP',
        h.inv_bkrm AS 'Biaya Kirim',
        h.inv_mp_biaya_platform AS 'Biaya Platform',

        -- Nominal Netto
        (COALESCE(DC.TotalItemNetto, 0) - COALESCE(h.inv_disc, 0) + h.inv_ppn + h.inv_bkrm - COALESCE(h.inv_mp_biaya_platform, 0)) AS 'Nominal',

        -- Bayar
        (
           (COALESCE(DC.TotalItemNetto, 0) - COALESCE(h.inv_disc, 0) + h.inv_ppn + h.inv_bkrm - COALESCE(h.inv_mp_biaya_platform, 0)) 
           - 
           IF(COALESCE(PR.SaldoAkhir, 0) < 0, 0, COALESCE(PR.SaldoAkhir, (COALESCE(DC.TotalItemNetto, 0) - COALESCE(h.inv_disc, 0) + h.inv_ppn + h.inv_bkrm - COALESCE(h.inv_mp_biaya_platform, 0))))
        ) AS 'Bayar',

        -- Sisa Piutang
        IF(COALESCE(PR.SaldoAkhir, 0) < 0, 0, 
           COALESCE(PR.SaldoAkhir, (COALESCE(DC.TotalItemNetto, 0) - COALESCE(h.inv_disc, 0) + h.inv_ppn + h.inv_bkrm - COALESCE(h.inv_mp_biaya_platform, 0)))
        ) AS 'Sisa Piutang'

    FROM tinv_hdr h
    INNER JOIN BaseInvoices fb ON fb.inv_nomor = h.inv_nomor
    LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
    LEFT JOIN hrd2.karyawan k ON k.kar_nik = h.inv_cus_kode
    LEFT JOIN tso_hdr o ON o.so_nomor = h.inv_nomor_so
    LEFT JOIN DetailCalc DC ON DC.invd_inv_nomor = h.inv_nomor
    LEFT JOIN PiutangReal PR ON PR.ph_inv_nomor = h.inv_nomor
    
    ORDER BY h.inv_tanggal DESC, h.inv_nomor DESC;
  `;

  // [PENTING] Jangan push limit & offset ke params
  // params.push(limit, offset); <-- JANGAN ADA INI

  const [rows] = await pool.query(query, params);
  return rows;
};

const getExportDetails = async (filters) => {
  const { startDate, endDate, cabang, status, search, columnFilters } = filters;

  // 1. Params Dasar (Tanggal)
  const params = [startDate, endDate];

  // 2. Filter Cabang
  let branchFilter = "";
  if (cabang && cabang !== "KDC" && cabang !== "ALL") {
    branchFilter = " AND h.inv_cab = ? ";
    params.push(cabang);
  }

  // 3. Filter Pencarian Global
  let searchFilter = "";
  if (search) {
    searchFilter = `
      AND (
        h.inv_nomor LIKE ? OR 
        c.cus_nama LIKE ? OR 
        h.inv_cus_kode LIKE ? OR
        h.inv_nomor_so LIKE ?
      )
    `;
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  // 4. Dynamic Column Filters (Opsional)
  let dynamicFilter = "";
  if (columnFilters) {
    try {
      const filtersObj = JSON.parse(columnFilters);
      const fieldMap = {
        Nomor: "h.inv_nomor",
        Customer: "c.cus_nama",
        Kdcus: "h.inv_cus_kode",
        NomorSO: "h.inv_nomor_so",
      };

      for (const [key, filter] of Object.entries(filtersObj)) {
        let dbField = fieldMap[key];
        if (!dbField) continue;

        if (
          filter.type === "multi" &&
          Array.isArray(filter.values) &&
          filter.values.length > 0
        ) {
          const placeholders = filter.values.map(() => "?").join(",");
          dynamicFilter += ` AND ${dbField} IN (${placeholders}) `;
          params.push(...filter.values);
        } else if (
          filter.type === "custom" &&
          filter.operator &&
          filter.value !== undefined
        ) {
          const val = filter.value;
          switch (filter.operator) {
            case "=":
              dynamicFilter += ` AND ${dbField} = ? `;
              params.push(val);
              break;
            case "contains":
              dynamicFilter += ` AND ${dbField} LIKE ? `;
              params.push(`%${val}%`);
              break;
          }
        }
      }
    } catch (e) {}
  }

  // 5. Filter Sisa Piutang
  let piutangSubQuery = "";
  if (status === "sisa_piutang" || status === "belum_lunas") {
    piutangSubQuery = `
      AND EXISTS (
        SELECT 1 
        FROM tpiutang_hdr ph
        LEFT JOIN (
            SELECT pd_ph_nomor, SUM(pd_debet) as debet, SUM(pd_kredit) as kredit
            FROM tpiutang_dtl
            GROUP BY pd_ph_nomor
        ) pd ON pd.pd_ph_nomor = ph.ph_nomor
        WHERE ph.ph_inv_nomor = h.inv_nomor
        AND (IFNULL(pd.debet, 0) - IFNULL(pd.kredit, 0)) > 100
      )
    `;
  }

  const query = `
        SELECT 
            h.inv_nomor AS 'Nomor Invoice',
            
            -- [FIX] Gunakan format ISO YYYY-MM-DD agar JS Frontend bisa membacanya
            DATE_FORMAT(h.inv_tanggal, '%Y-%m-%d') AS 'Tanggal',
            
            h.inv_nomor_so AS 'Nomor SO',
            c.cus_nama AS 'Customer',
            d.invd_kode AS 'Kode Barang',
            
            TRIM(CONCAT(
              IFNULL(a.brg_jeniskaos,''), " ", 
              IFNULL(a.brg_tipe,''), " ", 
              IFNULL(a.brg_lengan,''), " ", 
              IFNULL(a.brg_jeniskain,''), " ", 
              IFNULL(a.brg_warna,'')
            )) AS 'Nama Barang',
            
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
          AND DATE(h.inv_tanggal) BETWEEN ? AND ?
          ${branchFilter}
          ${searchFilter}
          ${dynamicFilter}
          ${piutangSubQuery} -- Pastikan ini aktif untuk filter piutang
          
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
      [nomor],
    );

    if (invRows.length === 0) throw new Error("Invoice tidak ditemukan.");
    const inv = invRows[0];

    // 2. Cek Lock FSK (Form Setor Kasir)
    const [fskRows] = await connection.query(
      "SELECT 1 FROM tform_setorkasir_dtl WHERE fskd_inv = ? LIMIT 1",
      [nomor],
    );
    if (fskRows.length > 0) {
      throw new Error(
        "Invoice sudah disetor (FSK). Tidak bisa ubah pembayaran.",
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
      [nomor],
    );

    if (oldSetor.length > 0) {
      const listSetor = oldSetor.map((r) => r.sd_sh_nomor);
      // Hapus Detail Setoran
      await connection.query(
        "DELETE FROM tsetor_dtl WHERE sd_sh_nomor IN (?)",
        [listSetor],
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
      [piutangNomor],
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
        [
          piutangNomor,
          tglSql,
          nominalBayar,
          `Ubah ke Tunai (${alasan})`,
          idrec,
        ],
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
        inv.inv_tanggal,
      );
      updateParams.push(nominalBayar, nomorSetoranBaru);

      // 1. Insert tsetor_hdr
      await connection.query(
        `INSERT INTO tsetor_hdr (
           sh_idrec, sh_nomor, sh_cus_kode, sh_tanggal, sh_jenis, sh_nominal, 
           sh_akun, sh_norek, sh_tgltransfer, sh_otomatis, user_create, date_create
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Y', ?, NOW())`,
        [
          idrec,
          nomorSetoranBaru,
          inv.inv_cus_kode,
          tglSql,
          jenisSetor,
          nominalBayar,
          bank?.kode || "",
          noRek || "",
          tglSql,
          user.kode,
        ],
      );

      // 2. Insert tsetor_dtl (Link Invoice ke Setoran)
      await connection.query(
        `INSERT INTO tsetor_dtl (
           sd_idrec, sd_sh_nomor, sd_tanggal, sd_inv, sd_bayar, sd_ket, sd_angsur, sd_nourut
         ) VALUES (?, ?, ?, ?, ?, 'PEMBAYARAN DARI KASIR', ?, 1)`,
        [idrec, nomorSetoranBaru, tglSql, nomor, nominalBayar, idrec],
      );

      // 3. Insert tpiutang_dtl (Pelunasan via Transfer)
      await connection.query(
        `INSERT INTO tpiutang_dtl (pd_ph_nomor, pd_tanggal, pd_uraian, pd_kredit, pd_ket, pd_sd_angsur)
         VALUES (?, ?, 'Pembayaran Card', ?, ?, ?)`,
        [piutangNomor, tglSql, nominalBayar, nomorSetoranBaru, idrec],
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
  getExportHeader,
  getExportDetails,
  checkIfInvoiceInFsk,
  changePaymentMethod,
};
