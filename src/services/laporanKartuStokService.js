const pool = require("../config/database");
const { parseISO, format, addDays, subDays } = require("date-fns");

// ------------------------------------------------------
// Helper: Samakan logika Jenis + Dawal persis Delphi
// ------------------------------------------------------
const resolvePeriode = async (gudang, startDate) => {
  let jenis = 0;
  let dawal = startDate;
  let startDateEff = startDate;

  const [rows] = await pool.query(
    "SELECT gdg_last_sop, gdg_lastSopOld FROM tgudang WHERE gdg_kode = ?",
    [gudang],
  );

  if (rows.length > 0) {
    const { gdg_last_sop, gdg_lastSopOld } = rows[0] || {};
    const start = new Date(startDate);

    if (gdg_last_sop && !gdg_lastSopOld) {
      const lastSop = new Date(gdg_last_sop);

      if (start < lastSop) {
        // start < last SOP
        startDateEff = format(lastSop, "yyyy-MM-dd");
        dawal = startDateEff;
        jenis = 0;
      } else {
        // start >= last SOP  (di Delphi: else -> Jenis=1, Dawal=last_sop)
        jenis = 1;
        dawal = format(lastSop, "yyyy-MM-dd");
        startDateEff = format(start, "yyyy-MM-dd");
      }
    } else if (gdg_last_sop && gdg_lastSopOld) {
      const lastSop = new Date(gdg_last_sop);
      const lastSopOld = new Date(gdg_lastSopOld);

      if (start <= lastSopOld) {
        // start <= lastSopOld
        startDateEff = format(lastSopOld, "yyyy-MM-dd");
        dawal = startDateEff;
        jenis = 0;
      } else if (start > lastSopOld && start < lastSop) {
        // lastSopOld < start < lastSop
        dawal = format(lastSopOld, "yyyy-MM-dd");
        jenis = 1;
        startDateEff = format(start, "yyyy-MM-dd");
      } else if (start.getTime() === lastSop.getTime()) {
        // start = lastSop
        dawal = format(lastSop, "yyyy-MM-dd");
        jenis = 0;
        startDateEff = format(start, "yyyy-MM-dd");
      } else if (start > lastSop) {
        // start > lastSop
        dawal = format(lastSop, "yyyy-MM-dd");
        jenis = 1;
        startDateEff = format(start, "yyyy-MM-dd");
      }
    } else {
      // Tidak ada info SOP di gudang
      jenis = 0;
      dawal = startDate;
      startDateEff = startDate;
    }
  }

  return { jenis, dawal, startDateEff };
};

// ------------------------------------------------------
// 1. PRODUCT LIST (HEADER LAPORAN KARTU STOK) - STORE
// ------------------------------------------------------
const getProductList = async (filters) => {
  const { gudang, kodeBarang, startDate, endDate } = filters;

  if (!gudang || !startDate || !endDate) {
    throw new Error("gudang, startDate, dan endDate harus diisi");
  }

  let query = `
    SELECT
      b.brgd_kode AS kode,
      TRIM(CONCAT(COALESCE(a.brg_jeniskaos,''),' ',COALESCE(a.brg_tipe,''),' ',COALESCE(a.brg_lengan,''),' ',COALESCE(a.brg_jeniskain,''),' ',COALESCE(a.brg_warna,''))) AS nama,
      b.brgd_ukuran AS ukuran,

      COALESCE(awal.stok,0)       AS stokAwal,
      COALESCE(sop.stok,0)        AS selisihSop,
      COALESCE(kor.stok,0)        AS koreksi,
      COALESCE(rj.stok,0)         AS returJual,
      COALESCE(tj.stok,0)         AS terimaSJ,
      COALESCE(mst.stok,0)        AS mutStoreTerima,
      COALESCE(msi.stok,0)        AS mutInPesan,
      COALESCE(mip.stok,0)        AS mutInProduksi,
      (COALESCE(inv.stok,0) + COALESCE(invso.stok,0)) AS invoice,
      COALESCE(rb.stok,0)         AS returKeDC,
      COALESCE(msk.stok,0)        AS mutStoreKirim,
      COALESCE(mso.stok,0)        AS mutOutPesan,
      COALESCE(mop.stok,0)        AS mutOutProduksi,

      (
        (COALESCE(awal.stok,0) + COALESCE(sop.stok,0) + COALESCE(kor.stok,0) +
         COALESCE(rj.stok,0) + COALESCE(tj.stok,0) + COALESCE(mst.stok,0) +
         COALESCE(msi.stok,0) + COALESCE(mip.stok,0))
        -
        (COALESCE(inv.stok,0) + COALESCE(invso.stok,0) + COALESCE(rb.stok,0) +
         COALESCE(msk.stok,0) + COALESCE(mso.stok,0) + COALESCE(mop.stok,0))
      ) AS saldoAkhir

    FROM tbarangdc_dtl b
    LEFT JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
  `;

  const params = [];

  // --- STOK AWAL (MURNI SUM DARI AWAL S/D H-1 DENGAN FILTER Y) ---
  query += `
      LEFT JOIN (
        SELECT m.mst_brg_kode, m.mst_ukuran, IFNULL(SUM(m.mst_stok_in - m.mst_stok_out),0) AS stok
        FROM tmasterstok m
        WHERE m.mst_cab = ? AND m.mst_tanggal < ? AND m.mst_aktif = 'Y'
        GROUP BY m.mst_brg_kode, m.mst_ukuran
      ) awal ON awal.mst_brg_kode = b.brgd_kode AND awal.mst_ukuran = b.brgd_ukuran
  `;
  params.push(gudang, startDate);

  // --- JOIN MUTASI (SEMUA BACA DARI TMASTERSTOK & FILTER Y) ---
  query += `
  LEFT JOIN (
    SELECT mst_brg_kode, mst_ukuran, IFNULL(SUM(mst_stok_in - mst_stok_out),0) AS stok
    FROM tmasterstok
    WHERE mst_cab = ? AND MID(mst_noreferensi,5,3) = 'SOP' AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
    GROUP BY mst_brg_kode, mst_ukuran
  ) sop ON sop.mst_brg_kode = b.brgd_kode AND sop.mst_ukuran = b.brgd_ukuran

  LEFT JOIN (
    SELECT mst_brg_kode, mst_ukuran, IFNULL(SUM(mst_stok_in),0) AS stok
    FROM tmasterstok
    WHERE mst_cab = ? AND MID(mst_noreferensi,5,3) = 'KOR' AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
    GROUP BY mst_brg_kode, mst_ukuran
  ) kor ON kor.mst_brg_kode = b.brgd_kode AND kor.mst_ukuran = b.brgd_ukuran

  LEFT JOIN (
    SELECT mst_brg_kode, mst_ukuran, IFNULL(SUM(mst_stok_in),0) AS stok
    FROM tmasterstok
    WHERE mst_cab = ? AND MID(mst_noreferensi,5,2) = 'RJ' AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
    GROUP BY mst_brg_kode, mst_ukuran
  ) rj ON rj.mst_brg_kode = b.brgd_kode AND rj.mst_ukuran = b.brgd_ukuran

  LEFT JOIN (
    SELECT mst_brg_kode, mst_ukuran, IFNULL(SUM(mst_stok_in),0) AS stok
    FROM tmasterstok
    WHERE mst_cab = ? AND MID(mst_noreferensi,5,2) IN ('TJ','SJ') AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
    GROUP BY mst_brg_kode, mst_ukuran
  ) tj ON tj.mst_brg_kode = b.brgd_kode AND tj.mst_ukuran = b.brgd_ukuran

  LEFT JOIN (
    SELECT mst_brg_kode, mst_ukuran, IFNULL(SUM(mst_stok_in),0) AS stok
    FROM tmasterstok
    WHERE mst_cab = ? AND MID(mst_noreferensi,5,3) IN ('MST','MTS') AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
    GROUP BY mst_brg_kode, mst_ukuran
  ) mst ON mst.mst_brg_kode = b.brgd_kode AND mst.mst_ukuran = b.brgd_ukuran

  LEFT JOIN (
    SELECT mst_brg_kode, mst_ukuran, IFNULL(SUM(mst_stok_in),0) AS stok
    FROM tmasterstokso
    WHERE mst_cab = ? AND MID(mst_noreferensi,4,3) = 'MSI' AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
    GROUP BY mst_brg_kode, mst_ukuran
  ) msi ON msi.mst_brg_kode = b.brgd_kode AND msi.mst_ukuran = b.brgd_ukuran

  LEFT JOIN (
    SELECT mst_brg_kode, mst_ukuran, IFNULL(SUM(mst_stok_in),0) AS stok
    FROM tmasterstokso
    WHERE mst_cab = ? AND MID(mst_noreferensi,4,2) = 'MI' AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
    GROUP BY mst_brg_kode, mst_ukuran
  ) mip ON mip.mst_brg_kode = b.brgd_kode AND mip.mst_ukuran = b.brgd_ukuran

  LEFT JOIN (
    SELECT mst_brg_kode, mst_ukuran, IFNULL(SUM(mst_stok_out),0) AS stok
    FROM tmasterstok
    WHERE mst_cab = ? AND MID(mst_noreferensi,5,3) = 'INV' AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
    GROUP BY mst_brg_kode, mst_ukuran
  ) inv ON inv.mst_brg_kode = b.brgd_kode AND inv.mst_ukuran = b.brgd_ukuran

  LEFT JOIN (
    SELECT mst_brg_kode, mst_ukuran, IFNULL(SUM(mst_stok_out),0) AS stok
    FROM tmasterstokso
    WHERE mst_cab = ? AND MID(mst_noreferensi,5,3) = 'INV' AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
    GROUP BY mst_brg_kode, mst_ukuran
  ) invso ON invso.mst_brg_kode = b.brgd_kode AND invso.mst_ukuran = b.brgd_ukuran

  LEFT JOIN (
    SELECT mst_brg_kode, mst_ukuran, IFNULL(SUM(mst_stok_out),0) AS stok
    FROM tmasterstok
    WHERE mst_cab = ? AND MID(mst_noreferensi,5,2) = 'RB' AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
    GROUP BY mst_brg_kode, mst_ukuran
  ) rb ON rb.mst_brg_kode = b.brgd_kode AND rb.mst_ukuran = b.brgd_ukuran

  LEFT JOIN (
    SELECT mst_brg_kode, mst_ukuran, IFNULL(SUM(mst_stok_out),0) AS stok
    FROM tmasterstok
    WHERE mst_cab = ? AND MID(mst_noreferensi,5,3) IN ('MSK','MTS') AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
    GROUP BY mst_brg_kode, mst_ukuran
  ) msk ON msk.mst_brg_kode = b.brgd_kode AND msk.mst_ukuran = b.brgd_ukuran

  LEFT JOIN (
    SELECT mst_brg_kode, mst_ukuran, IFNULL(SUM(mst_stok_out),0) AS stok
    FROM tmasterstok
    WHERE mst_cab = ? AND MID(mst_noreferensi,4,3) = 'MSO' AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
    GROUP BY mst_brg_kode, mst_ukuran
  ) mso ON mso.mst_brg_kode = b.brgd_kode AND mso.mst_ukuran = b.brgd_ukuran

  LEFT JOIN (
    SELECT mst_brg_kode, mst_ukuran, IFNULL(SUM(mst_stok_out),0) AS stok
    FROM tmasterstok
    WHERE mst_cab = ? AND MID(mst_noreferensi,4,2) = 'MO' AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
    GROUP BY mst_brg_kode, mst_ukuran
  ) mop ON mop.mst_brg_kode = b.brgd_kode AND mop.mst_ukuran = b.brgd_ukuran
  `;

  // 13 Params karena ada 13 JOIN yang baca tanggal
  const p = [gudang, startDate, endDate];
  params.push(
    ...p,
    ...p,
    ...p,
    ...p,
    ...p,
    ...p,
    ...p,
    ...p,
    ...p,
    ...p,
    ...p,
    ...p,
    ...p,
  );

  query += `
    WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
  `;

  if (kodeBarang) {
    query += ` AND b.brgd_kode = ?`;
    params.push(kodeBarang);
  }

  query += `
    GROUP BY b.brgd_kode, b.brgd_ukuran
    HAVING (
         stokAwal <> 0 
      OR selisihSop <> 0 
      OR koreksi <> 0 
      OR returJual <> 0 
      OR terimaSJ <> 0 
      OR mutStoreTerima <> 0 
      OR mutInPesan <> 0 
      OR mutInProduksi <> 0
      OR invoice <> 0 
      OR returKeDC <> 0 
      OR mutStoreKirim <> 0 
      OR mutOutPesan <> 0
      OR mutOutProduksi <> 0
    )
    ORDER BY b.brgd_kode, b.brgd_ukuran
  `;

  const [rows] = await pool.query(query, params);

  // Karena kita sudah menghitung saldoAkhir di SQL, kita tidak perlu me-map ulang
  return rows;
};

// ------------------------------------------------------
// 2. DETAIL / KARTU STOK (PER KODE+UKURAN) - STORE
// ------------------------------------------------------
const getKartuDetails = async (filters) => {
  const { gudang, startDate, endDate, id } = filters;

  if (!gudang || !startDate || !endDate || !id) {
    throw new Error("gudang, startDate, endDate, dan id harus diisi");
  }

  const start = parseISO(startDate);
  const end = parseISO(endDate);
  const startDateStr = format(start, "yyyy-MM-dd");
  const endDateStr = format(end, "yyyy-MM-dd");

  // === STOK AWAL MURNI DARI AWAL S/D H-1 ===
  const stokAwalQuery = `
      SELECT 
        ? AS id, 
        ? AS tanggal, 
        'STOK AWAL' AS nomor, 
        '-' AS no_pesanan, 
        IFNULL(SUM(m.mst_stok_in - m.mst_stok_out), 0) AS \`In\`, 
        0 AS \`Out\`, 
        'Stok Awal' AS transaksi
      FROM tmasterstok m
      WHERE m.mst_cab = ? AND m.mst_tanggal < ? AND m.mst_aktif = 'Y' AND CONCAT(m.mst_brg_kode, m.mst_ukuran) = ?
  `;
  const stokAwalParams = [id, startDateStr, gudang, startDateStr, id];

  // === MUTASI UMUM SELAMA PERIODE (SOP OTOMATIS IKUT KESINI) ===
  const mutasiQuery = `
    SELECT 
      CONCAT(m.mst_brg_kode, m.mst_ukuran) AS id,
      m.mst_tanggal AS tanggal,
      m.mst_noreferensi AS nomor,
      '-' AS no_pesanan,
      COALESCE(SUM(m.mst_stok_in), 0) AS \`In\`,
      COALESCE(SUM(m.mst_stok_out), 0) AS \`Out\`,
      CASE
          -- [PERBAIKAN]: Keterangan Dinamis untuk SOP (Koreksi Plus / Minus)
          WHEN m.mst_noreferensi LIKE '%SOP%' AND SUM(m.mst_stok_in) > 0 THEN 'Koreksi Stok Opname Plus'
          WHEN m.mst_noreferensi LIKE '%SOP%' AND SUM(m.mst_stok_out) > 0 THEN 'Koreksi Stok Opname Minus'
          
          WHEN m.mst_noreferensi LIKE '%KOR%' THEN 'Koreksi'
          WHEN m.mst_noreferensi LIKE '%RJ%'  THEN 'Retur Jual'
          WHEN m.mst_noreferensi LIKE '%TJ%' OR m.mst_noreferensi LIKE '%SJ%' THEN 'Surat Jalan / STBJ'
          WHEN m.mst_noreferensi LIKE '%MST%' THEN 'Mutasi Store Terima' 
          
          -- [PERBAIKAN TAMBAHAN]: Mencegah bug ONLY_FULL_GROUP_BY di MySQL versi baru
          WHEN m.mst_noreferensi LIKE '%MTS%' AND SUM(m.mst_stok_in) > 0 THEN 'Mutasi Masuk' 
          WHEN m.mst_noreferensi LIKE '%MTS%' AND SUM(m.mst_stok_out) > 0 THEN 'Mutasi Keluar'
          
          WHEN m.mst_noreferensi LIKE '%MSI%' THEN 'Mutasi Stok dari Pesanan'
          WHEN m.mst_noreferensi LIKE '%INV%' THEN 'Invoice'
          WHEN m.mst_noreferensi LIKE '%RB%'  THEN 'Retur Barang ke DC'
          WHEN m.mst_noreferensi LIKE '%MSK%' THEN 'Mutasi Store Kirim'
          WHEN m.mst_noreferensi LIKE '%MO%'  THEN 'Mutasi Out ke Produksi'
          WHEN m.mst_noreferensi LIKE '%MSO%' THEN 'Mutasi Stok ke Pesanan'
          WHEN m.mst_noreferensi LIKE '%MI%'  THEN 'Mutasi In from Produksi'
          ELSE 'Lain-lain'
      END AS transaksi
    FROM tmasterstok m
    WHERE m.mst_cab = ? AND m.mst_tanggal BETWEEN ? AND ? AND m.mst_aktif = 'Y' AND CONCAT(m.mst_brg_kode, m.mst_ukuran) = ?
    GROUP BY m.mst_brg_kode, m.mst_ukuran, m.mst_noreferensi, m.mst_tanggal
  `;
  const mutasiParams = [gudang, startDateStr, endDateStr, id];

  // === MUTASI PESANAN (tmasterstokso) ===
  const mutasiPesananQuery = `
    SELECT 
      CONCAT(m.mst_brg_kode, m.mst_ukuran) AS id,
      m.mst_tanggal AS tanggal,
      m.mst_noreferensi AS nomor,
      m.mst_nomor_so AS no_pesanan,
      COALESCE(SUM(m.mst_stok_in), 0) AS \`In\`,
      COALESCE(SUM(m.mst_stok_out), 0) AS \`Out\`,
      CASE
          WHEN m.mst_noreferensi LIKE '%MSO%' THEN 'Mutasi Stok ke Pesanan'
          WHEN m.mst_noreferensi LIKE '%MSI%' THEN 'Mutasi Stok dari Pesanan'
          WHEN m.mst_noreferensi LIKE '%INV%' THEN 'Invoice'
          WHEN m.mst_noreferensi LIKE '%MI%'  THEN 'Mutasi In from Produksi'
          ELSE 'Transaksi Pesanan'
      END AS transaksi
    FROM tmasterstokso m
    WHERE m.mst_cab = ? AND m.mst_tanggal BETWEEN ? AND ? AND m.mst_aktif = 'Y' AND CONCAT(m.mst_brg_kode, m.mst_ukuran) = ?
    GROUP BY m.mst_brg_kode, m.mst_ukuran, m.mst_noreferensi, m.mst_tanggal, m.mst_nomor_so
  `;
  const mutasiPesananParams = [gudang, startDateStr, endDateStr, id];

  // Gabungkan
  const fullQuery = `
    (${stokAwalQuery})
    UNION ALL
    (${mutasiQuery})
    UNION ALL
    (${mutasiPesananQuery})
    ORDER BY tanggal, nomor
  `;

  const params = [...stokAwalParams, ...mutasiParams, ...mutasiPesananParams];
  const [rows] = await pool.query(fullQuery, params);

  // Hitung saldo berjalan
  let saldo = 0;
  const resultWithSaldo = rows.map((row) => {
    const masuk = row.In || row.in || 0;
    const keluar = row.Out || row.out || 0;
    saldo += masuk - keluar;
    return {
      ...row,
      no_pesanan: row.no_pesanan || "-",
      saldo,
    };
  });

  return resultWithSaldo;
};

// ------------------------------------------------------
// 3. MUTATION DETAILS (REKAP PER PERIODE PER KODE)
// ------------------------------------------------------
const getMutationDetails = async (filters) => {
  const {
    startDate,
    endDate,
    gudang,
    gudangDc: gudangDcStr,
    kodeProduk,
  } = filters;
  const gudangDc = parseInt(gudangDcStr, 10);

  let query = "";
  let params = [];

  if (gudangDc === 0 || gudangDc === 3) {
    // =================================================================================
    // QUERY DETAIL UNTUK STORE (LEBIH RINGAN & AKURAT 100%)
    // Menggunakan CASE WHEN untuk mengelompokkan kolom, dan SUM murni untuk Saldo Akhir
    // =================================================================================
    query = `
      SELECT
        b.brgd_ukuran AS ukuran,
        
        COALESCE(awal.stok, 0) AS stokAwal,
        COALESCE(sop.selisihSop, 0) AS selisihSop,
        COALESCE(mut.koreksi, 0) AS koreksi,
        COALESCE(mut.returJual, 0) AS returJual,
        COALESCE(mut.terimaSJ, 0) AS terimaSJ,
        COALESCE(mut.mutStoreTerima, 0) AS mutStoreTerima,
        COALESCE(mut.returKeDC, 0) AS returKeDC,
        COALESCE(mut.mutStoreKirim, 0) AS mutStoreKirim,
        COALESCE(mut.mutOutProduksi, 0) AS mutOutProduksi,
        (COALESCE(mut.invoice, 0) + COALESCE(mso.invoiceSo, 0)) AS invoice,
        COALESCE(mso.mutInPesan, 0) AS mutInPesan,
        COALESCE(mso.mutOutPesan, 0) AS mutOutPesan,
        COALESCE(mso.mutInProduksi, 0) AS mutInProduksi,

        -- [KUNCI KEAKURATAN]: Saldo Akhir dihitung murni dari Total IN - OUT 
        -- Tidak peduli prefixnya apa, pasti terhitung semua!
        (COALESCE(awal.stok, 0) + COALESCE(sop.selisihSop, 0) + COALESCE(mut.totalMutasi, 0) + COALESCE(mso.totalMutasiSo, 0)) AS saldoAkhir
        
      FROM tbarangdc_dtl b
      LEFT JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
      
      -- 1. STOK AWAL MURNI
      LEFT JOIN (
          SELECT mst_ukuran, SUM(mst_stok_in - mst_stok_out) AS stok
          FROM tmasterstok
          WHERE mst_cab = ? AND mst_brg_kode = ? AND mst_tanggal < ? AND mst_aktif = 'Y'
          GROUP BY mst_ukuran
      ) awal ON awal.mst_ukuran = b.brgd_ukuran
      
      -- 2. SELISIH STOK OPNAME (SOP)
      LEFT JOIN (
          SELECT mst_ukuran, SUM(mst_stok_in - mst_stok_out) AS selisihSop
          FROM tmasterstok
          WHERE mst_cab = ? AND mst_brg_kode = ? AND MID(mst_noreferensi,5,3) = 'SOP' AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
          GROUP BY mst_ukuran
      ) sop ON sop.mst_ukuran = b.brgd_ukuran
      
      -- 3. MUTASI UMUM (Tarik semua prefix sekaligus)
      LEFT JOIN (
          SELECT 
              mst_ukuran,
              SUM(CASE WHEN MID(mst_noreferensi,5,3) = 'KOR' THEN mst_stok_in - mst_stok_out ELSE 0 END) AS koreksi,
              SUM(CASE WHEN MID(mst_noreferensi,5,2) = 'RJ' THEN mst_stok_in ELSE 0 END) AS returJual,
              -- [FIX BUGS]: SJ dan TS sekarang ditangkap dengan benar!
              SUM(CASE WHEN MID(mst_noreferensi,5,2) IN ('SJ', 'TJ') THEN mst_stok_in ELSE 0 END) AS terimaSJ,
              SUM(CASE WHEN MID(mst_noreferensi,5,3) IN ('MST', 'MTS') OR MID(mst_noreferensi,5,2) = 'TS' THEN mst_stok_in ELSE 0 END) AS mutStoreTerima,
              SUM(CASE WHEN MID(mst_noreferensi,5,3) IN ('MSK', 'MTS') THEN mst_stok_out ELSE 0 END) AS mutStoreKirim,
              SUM(CASE WHEN MID(mst_noreferensi,5,3) = 'INV' THEN mst_stok_out ELSE 0 END) AS invoice,
              SUM(CASE WHEN MID(mst_noreferensi,5,2) = 'RB' THEN mst_stok_out ELSE 0 END) AS returKeDC,
              SUM(CASE WHEN MID(mst_noreferensi,4,2) = 'MO' THEN mst_stok_out ELSE 0 END) AS mutOutProduksi,
              -- Total Mutasi Murni (Selain SOP karena SOP sudah dihitung di atas)
              SUM(CASE WHEN MID(mst_noreferensi,5,3) != 'SOP' THEN mst_stok_in - mst_stok_out ELSE 0 END) AS totalMutasi
          FROM tmasterstok
          WHERE mst_cab = ? AND mst_brg_kode = ? AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
          GROUP BY mst_ukuran
      ) mut ON mut.mst_ukuran = b.brgd_ukuran
      
      -- 4. MUTASI PESANAN (SO)
      LEFT JOIN (
          SELECT
              mst_ukuran,
              SUM(CASE WHEN MID(mst_noreferensi,4,3) = 'MSI' THEN mst_stok_in ELSE 0 END) AS mutInPesan,
              SUM(CASE WHEN MID(mst_noreferensi,4,3) = 'MSO' THEN mst_stok_out ELSE 0 END) AS mutOutPesan,
              SUM(CASE WHEN MID(mst_noreferensi,4,2) = 'MI' THEN mst_stok_in ELSE 0 END) AS mutInProduksi,
              SUM(CASE WHEN MID(mst_noreferensi,5,3) = 'INV' THEN mst_stok_out ELSE 0 END) AS invoiceSo,
              SUM(mst_stok_in - mst_stok_out) AS totalMutasiSo
          FROM tmasterstokso
          WHERE mst_cab = ? AND mst_brg_kode = ? AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
          GROUP BY mst_ukuran
      ) mso ON mso.mst_ukuran = b.brgd_ukuran
      
      WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y' AND b.brgd_kode = ?
      
      HAVING (
          stokAwal <> 0 
       OR selisihSop <> 0 
       OR koreksi <> 0 
       OR returJual <> 0 
       OR terimaSJ <> 0 
       OR mutStoreTerima <> 0 
       OR mutInPesan <> 0 
       OR mutInProduksi <> 0
       OR invoice <> 0 
       OR returKeDC <> 0 
       OR mutStoreKirim <> 0 
       OR mutOutPesan <> 0
       OR mutOutProduksi <> 0
      )
      ORDER BY b.brgd_ukuran
    `;

    params = [
      gudang,
      kodeProduk,
      startDate, // awal
      gudang,
      kodeProduk,
      startDate,
      endDate, // sop
      gudang,
      kodeProduk,
      startDate,
      endDate, // mut
      gudang,
      kodeProduk,
      startDate,
      endDate, // mso
      kodeProduk, // filter WHERE
    ];
  } else {
    // =================================================================================
    // QUERY DETAIL UNTUK GUDANG DC (KDC / K04 / K05 / Dst)
    // Menggunakan CASE WHEN untuk efisiensi tinggi dan Saldo Akhir yang Presisi
    // =================================================================================
    query = `
      SELECT
        b.brgd_ukuran AS ukuran,
        
        COALESCE(awal.stok, 0) AS stokAwal,
        COALESCE(sop.selisihSop, 0) AS selisihSop,
        
        COALESCE(mut.koreksi, 0) AS koreksi,
        COALESCE(mut.mutasiIn, 0) AS mutasiIn,
        COALESCE(mut.terimaQc, 0) AS terimaQc,
        COALESCE(mut.terimaSTBJ, 0) AS terimaSTBJ,
        COALESCE(mut.terimaGdgRepair, 0) AS terimaGdgRepair,
        COALESCE(mut.returStore, 0) AS returStore,
        COALESCE(mut.returJual, 0) AS returJual,
        COALESCE(mut.bpb, 0) AS bpb,
        COALESCE(mut.mct, 0) AS mct,
        
        COALESCE(mut.sj, 0) AS sj,
        COALESCE(mut.qc, 0) AS qc,
        COALESCE(mut.mutasiOut, 0) AS mutasiOut,
        COALESCE(mut.invoice, 0) AS invoice,
        COALESCE(mut.mck, 0) AS mck,

        -- [KUNCI KEAKURATAN]: Saldo Akhir dihitung murni dari Total IN - OUT 
        (COALESCE(awal.stok, 0) + COALESCE(sop.selisihSop, 0) + COALESCE(mut.totalMutasi, 0)) AS saldoAkhir
        
      FROM tbarangdc_dtl b
      LEFT JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
      
      -- 1. STOK AWAL MURNI
      LEFT JOIN (
          SELECT mst_ukuran, SUM(mst_stok_in - mst_stok_out) AS stok
          FROM tmasterstok
          WHERE mst_cab = ? AND mst_brg_kode = ? AND mst_tanggal < ? AND mst_aktif = 'Y'
          GROUP BY mst_ukuran
      ) awal ON awal.mst_ukuran = b.brgd_ukuran
      
      -- 2. SELISIH STOK OPNAME (SOP)
      LEFT JOIN (
          SELECT mst_ukuran, SUM(mst_stok_in - mst_stok_out) AS selisihSop
          FROM tmasterstok
          WHERE mst_cab = ? AND mst_brg_kode = ? AND MID(mst_noreferensi,5,3) = 'SOP' AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
          GROUP BY mst_ukuran
      ) sop ON sop.mst_ukuran = b.brgd_ukuran
      
      -- 3. MUTASI UMUM DC (Tarik semua prefix DC sekaligus)
      LEFT JOIN (
          SELECT 
              mst_ukuran,
              SUM(CASE WHEN MID(mst_noreferensi,5,3) = 'KOR' THEN mst_stok_in - mst_stok_out ELSE 0 END) AS koreksi,
              SUM(CASE WHEN MID(mst_noreferensi,5,3) = 'MTS' AND mst_mts = 'Y' THEN mst_stok_in ELSE 0 END) AS mutasiIn,
              SUM(CASE WHEN MID(mst_noreferensi,5,3) = 'MUT' THEN mst_stok_in ELSE 0 END) AS terimaQc,
              SUM(CASE WHEN MID(mst_noreferensi,5,2) = 'RB' THEN mst_stok_in ELSE 0 END) AS returStore,
              SUM(CASE WHEN MID(mst_noreferensi,5,2) = 'RJ' THEN mst_stok_in ELSE 0 END) AS returJual,
              SUM(CASE WHEN MID(mst_noreferensi,5,3) = 'BPB' THEN mst_stok_in ELSE 0 END) AS bpb,
              SUM(CASE WHEN MID(mst_noreferensi,5,3) = 'MCT' THEN mst_stok_in ELSE 0 END) AS mct,
              
              SUM(CASE WHEN MID(mst_noreferensi,5,2) = 'SJ' THEN mst_stok_out ELSE 0 END) AS sj,
              SUM(CASE WHEN MID(mst_noreferensi,5,2) = 'QC' THEN mst_stok_out ELSE 0 END) AS qc,
              SUM(CASE WHEN MID(mst_noreferensi,5,3) = 'MTS' AND mst_mts = 'Y' THEN mst_stok_out ELSE 0 END) AS mutasiOut,
              SUM(CASE WHEN MID(mst_noreferensi,5,3) = 'INV' THEN mst_stok_out ELSE 0 END) AS invoice,
              SUM(CASE WHEN MID(mst_noreferensi,5,3) = 'MCK' THEN mst_stok_out ELSE 0 END) AS mck,

              -- Penanganan khusus untuk Gudang KDC vs Gudang DC lain (seperti K04/K05)
              ${
                gudang === "KDC"
                  ? `
                SUM(CASE WHEN MID(mst_noreferensi,5,2) = 'TS' THEN mst_stok_in ELSE 0 END) AS terimaSTBJ,
                SUM(CASE WHEN MID(mst_noreferensi,5,2) = 'GT' THEN mst_stok_in ELSE 0 END) AS terimaGdgRepair,
              `
                  : `
                SUM(CASE WHEN MID(mst_noreferensi,5,3) = 'MTS' AND mst_mts = '' THEN mst_stok_in ELSE 0 END) AS terimaSTBJ,
                SUM(CASE WHEN MID(mst_noreferensi,5,3) = 'MTS' AND mst_mts = 'T' THEN mst_stok_in ELSE 0 END) AS terimaGdgRepair,
              `
              }

              -- Total Mutasi Murni (Selain SOP)
              SUM(CASE WHEN MID(mst_noreferensi,5,3) != 'SOP' THEN mst_stok_in - mst_stok_out ELSE 0 END) AS totalMutasi
          FROM tmasterstok
          WHERE mst_cab = ? AND mst_brg_kode = ? AND mst_tanggal BETWEEN ? AND ? AND mst_aktif = 'Y'
          GROUP BY mst_ukuran
      ) mut ON mut.mst_ukuran = b.brgd_ukuran
      
      WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y' AND b.brgd_kode = ?
      
      HAVING (
          stokAwal <> 0 
       OR selisihSop <> 0 
       OR koreksi <> 0 
       OR mutasiIn <> 0 
       OR terimaQc <> 0 
       OR terimaSTBJ <> 0 
       OR terimaGdgRepair <> 0 
       OR returStore <> 0
       OR returJual <> 0
       OR bpb <> 0
       OR mct <> 0
       OR sj <> 0
       OR qc <> 0
       OR mutasiOut <> 0
       OR invoice <> 0
       OR mck <> 0
      )
      ORDER BY b.brgd_ukuran
    `;

    params = [
      gudang,
      kodeProduk,
      startDate, // params untuk stok awal
      gudang,
      kodeProduk,
      startDate,
      endDate, // params untuk selisihSop
      gudang,
      kodeProduk,
      startDate,
      endDate, // params untuk mutasi (mut)
      kodeProduk, // params filter WHERE
    ];
  }

  const [rows] = await pool.query(query, params);
  return rows;
};

const getGudangOptions = async (user) => {
  let query = "";
  let params = [];

  if (user.cabang === "KDC") {
    query = `
            SELECT 'ALL' AS kode, 'SEMUA CABANG' AS nama
            UNION ALL
            SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang ORDER BY kode
        `;
  } else {
    query =
      'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = "KDC" OR gdg_kode = ?';
    params.push(user.cabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getProductList,
  getMutationDetails,
  getKartuDetails,
  getGudangOptions,
};
