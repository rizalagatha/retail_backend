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
    [gudang]
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

  // Samakan logika periode dengan Delphi
  const { jenis, dawal, startDateEff } = await resolvePeriode(
    gudang,
    startDate
  );

  const dawalPlus1 = format(addDays(new Date(dawal), 1), "yyyy-MM-dd");
  const startDateMinus1 = format(
    subDays(new Date(startDateEff), 1),
    "yyyy-MM-dd"
  );

  console.log(">>> PRODUCTLIST DEBUG");
  console.log("jenis =", jenis);
  console.log("dawal =", dawal);
  console.log("startDateEff =", startDateEff);
  console.log("startDateMinus1 =", startDateMinus1);

  // Hanya implementasi STORE (gdg_dc = 0 / 3) sesuai Delphi bagian pertama
  let query = `
    SELECT
      b.brgd_kode AS kode,
      TRIM(CONCAT(a.brg_jeniskaos,' ',a.brg_tipe,' ',a.brg_lengan,' ',a.brg_jeniskain,' ',a.brg_warna)) AS nama,
      b.brgd_ukuran AS ukuran,

      COALESCE(awal.stok,0)       AS stokAwal,
      COALESCE(sop.stok,0)        AS selisihSop,
      COALESCE(kor.stok,0)        AS koreksi,
      COALESCE(rj.stok,0)         AS returJual,
      COALESCE(tj.stok,0)         AS terimaSJ,
      COALESCE(mst.stok,0)        AS mutStoreTerima,
      COALESCE(msi.stok,0)        AS mutInPesan,
      (COALESCE(inv.stok,0) + COALESCE(invso.stok,0)) AS invoice,
      COALESCE(rb.stok,0)         AS returKeDC,
      COALESCE(msk.stok,0)        AS mutStoreKirim,
      COALESCE(mso.stok,0)        AS mutOutPesan,

      (
        (COALESCE(awal.stok,0) + COALESCE(sop.stok,0) + COALESCE(kor.stok,0) +
         COALESCE(rj.stok,0) + COALESCE(tj.stok,0) + COALESCE(mst.stok,0) +
         COALESCE(msi.stok,0))
        -
        (COALESCE(inv.stok,0) + COALESCE(invso.stok,0) + COALESCE(rb.stok,0) +
         COALESCE(msk.stok,0) + COALESCE(mso.stok,0))
      ) AS saldoAkhir

    FROM tbarangdc_dtl b
    LEFT JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
  `;

  const params = [];

  // --- STOK AWAL (sama persis logika Delphi) ---
  if (jenis === 0) {
    query += `
      LEFT JOIN (
        SELECT m.mst_brg_kode, m.mst_ukuran,
               IFNULL(SUM(m.mst_stok_in),0) AS stok
        FROM tmasterstok m
        WHERE m.mst_cab = ?
          AND MID(m.mst_noreferensi,5,3) = 'SOP'
          AND m.mst_tanggal = ?
        GROUP BY m.mst_brg_kode, m.mst_ukuran
      ) awal ON awal.mst_brg_kode = b.brgd_kode
            AND awal.mst_ukuran   = b.brgd_ukuran
    `;
    params.push(gudang, dawal);
  } else {
    query += `
      LEFT JOIN (
        SELECT m.mst_brg_kode, m.mst_ukuran,
               IFNULL(SUM(m.mst_stok_in - m.mst_stok_out),0) AS stok
        FROM tmasterstok m
        WHERE m.mst_cab = ?
          AND m.mst_tanggal >= ?
          AND m.mst_tanggal <= ?
        GROUP BY m.mst_brg_kode, m.mst_ukuran
      ) awal ON awal.mst_brg_kode = b.brgd_kode
            AND awal.mst_ukuran   = b.brgd_ukuran
    `;
    params.push(gudang, dawal, startDateMinus1);
  }

  // --- JOIN lain (SOP, Koreksi, Retur, Mutasi, Invoice, dst) ---
  query += `
  LEFT JOIN (
  SELECT 
    d.sopd_kode AS kode,
    d.sopd_ukuran AS ukuran,
    SUM(d.sopd_selisih) AS stok
  FROM tsop_hdr h
  JOIN tsop_dtl d ON d.sopd_nomor = h.sop_nomor
  WHERE LEFT(h.sop_nomor,3) = ?
    AND h.sop_tanggal BETWEEN ? AND ?
  GROUP BY d.sopd_kode, d.sopd_ukuran
) sop ON sop.kode = b.brgd_kode
      AND sop.ukuran = b.brgd_ukuran

    LEFT JOIN (
  SELECT m.mst_brg_kode, m.mst_ukuran,
         IFNULL(SUM(m.mst_stok_in),0) AS stok
  FROM tmasterstok m
  WHERE m.mst_cab = ?
    AND m.mst_brg_kode = ?
    AND MID(m.mst_noreferensi,5,3) = 'KOR'
    AND m.mst_tanggal BETWEEN ? AND ?
  GROUP BY m.mst_brg_kode, m.mst_ukuran
) kor ON kor.mst_brg_kode = b.brgd_kode
     AND kor.mst_ukuran   = b.brgd_ukuran

LEFT JOIN (
  SELECT m.mst_brg_kode, m.mst_ukuran,
         IFNULL(SUM(m.mst_stok_in),0) AS stok
  FROM tmasterstok m
  WHERE m.mst_cab = ?
    AND m.mst_brg_kode = ?
    AND MID(m.mst_noreferensi,5,2) = 'RJ'
    AND m.mst_tanggal BETWEEN ? AND ?
  GROUP BY m.mst_brg_kode, m.mst_ukuran
) rj ON rj.mst_brg_kode = b.brgd_kode
     AND rj.mst_ukuran   = b.brgd_ukuran

LEFT JOIN (
  SELECT m.mst_brg_kode, m.mst_ukuran,
         IFNULL(SUM(m.mst_stok_in),0) AS stok
  FROM tmasterstok m
  WHERE m.mst_cab = ?
    AND m.mst_brg_kode = ?
    AND MID(m.mst_noreferensi,5,2) = 'TJ'
    AND m.mst_tanggal BETWEEN ? AND ?
  GROUP BY m.mst_brg_kode, m.mst_ukuran
) tj ON tj.mst_brg_kode = b.brgd_kode
     AND tj.mst_ukuran   = b.brgd_ukuran

LEFT JOIN (
  SELECT m.mst_brg_kode, m.mst_ukuran,
         IFNULL(SUM(m.mst_stok_in),0) AS stok
  FROM tmasterstok m
  WHERE m.mst_cab = ?
    AND m.mst_brg_kode = ?
    AND MID(m.mst_noreferensi,5,3) = 'MST'
    AND m.mst_tanggal BETWEEN ? AND ?
  GROUP BY m.mst_brg_kode, m.mst_ukuran
) mst ON mst.mst_brg_kode = b.brgd_kode
     AND mst.mst_ukuran   = b.brgd_ukuran

LEFT JOIN (
  SELECT m.mst_brg_kode, m.mst_ukuran,
         IFNULL(SUM(m.mst_stok_in),0) AS stok
  FROM tmasterstokso m
  WHERE m.mst_cab = ?
    AND m.mst_brg_kode = ?
    AND MID(m.mst_noreferensi,4,3) = 'MSI'
    AND m.mst_tanggal BETWEEN ? AND ?
  GROUP BY m.mst_brg_kode, m.mst_ukuran
) msi ON msi.mst_brg_kode = b.brgd_kode
     AND msi.mst_ukuran   = b.brgd_ukuran

LEFT JOIN (
  SELECT m.mst_brg_kode, m.mst_ukuran,
         IFNULL(SUM(m.mst_stok_out),0) AS stok
  FROM tmasterstok m
  WHERE m.mst_cab = ?
    AND m.mst_brg_kode = ?
    AND MID(m.mst_noreferensi,5,3) = 'INV'
    AND m.mst_tanggal BETWEEN ? AND ?
  GROUP BY m.mst_brg_kode, m.mst_ukuran
) inv ON inv.mst_brg_kode = b.brgd_kode
     AND inv.mst_ukuran   = b.brgd_ukuran

LEFT JOIN (
  SELECT m.mst_brg_kode, m.mst_ukuran,
         IFNULL(SUM(m.mst_stok_out),0) AS stok
  FROM tmasterstokso m
  WHERE m.mst_cab = ?
    AND m.mst_brg_kode = ?
    AND MID(m.mst_noreferensi,5,3) = 'INV'
    AND m.mst_tanggal BETWEEN ? AND ?
  GROUP BY m.mst_brg_kode, m.mst_ukuran
) invso ON invso.mst_brg_kode = b.brgd_kode
       AND invso.mst_ukuran   = b.brgd_ukuran

LEFT JOIN (
  SELECT m.mst_brg_kode, m.mst_ukuran,
         IFNULL(SUM(m.mst_stok_out),0) AS stok
  FROM tmasterstok m
  WHERE m.mst_cab = ?
    AND m.mst_brg_kode = ?
    AND MID(m.mst_noreferensi,5,2) = 'RB'
    AND m.mst_tanggal BETWEEN ? AND ?
  GROUP BY m.mst_brg_kode, m.mst_ukuran
) rb ON rb.mst_brg_kode = b.brgd_kode
     AND rb.mst_ukuran   = b.brgd_ukuran

LEFT JOIN (
  SELECT m.mst_brg_kode, m.mst_ukuran,
         IFNULL(SUM(m.mst_stok_out),0) AS stok
  FROM tmasterstok m
  WHERE m.mst_cab = ?
    AND m.mst_brg_kode = ?
    AND MID(m.mst_noreferensi,5,3) = 'MSK'
    AND m.mst_tanggal BETWEEN ? AND ?
  GROUP BY m.mst_brg_kode, m.mst_ukuran
) msk ON msk.mst_brg_kode = b.brgd_kode
     AND msk.mst_ukuran   = b.brgd_ukuran

LEFT JOIN (
  SELECT m.mst_brg_kode, m.mst_ukuran,
         IFNULL(SUM(m.mst_stok_out),0) AS stok
  FROM tmasterstok m
  WHERE m.mst_cab = ?
    AND m.mst_brg_kode = ?
    AND MID(m.mst_noreferensi,4,3) = 'MSO'
    AND m.mst_tanggal BETWEEN ? AND ?
  GROUP BY m.mst_brg_kode, m.mst_ukuran
) mso ON mso.mst_brg_kode = b.brgd_kode
     AND mso.mst_ukuran   = b.brgd_ukuran
  `;

  params.push(
    // SOP
    gudang,
    dawalPlus1,
    endDate,

    // KOR
    gudang,
    kodeBarang,
    startDateEff,
    endDate,

    // RJ
    gudang,
    kodeBarang,
    startDateEff,
    endDate,

    // TJ
    gudang,
    kodeBarang,
    startDateEff,
    endDate,

    // MST
    gudang,
    kodeBarang,
    startDateEff,
    endDate,

    // MSI
    gudang,
    kodeBarang,
    startDateEff,
    endDate,

    // INV TOKO
    gudang,
    kodeBarang,
    startDateEff,
    endDate,

    // INV SO
    gudang,
    kodeBarang,
    startDateEff,
    endDate,

    // RB
    gudang,
    kodeBarang,
    startDateEff,
    endDate,

    // MSK
    gudang,
    kodeBarang,
    startDateEff,
    endDate,

    // MSO
    gudang,
    kodeBarang,
    startDateEff,
    endDate
  );

  // Filter barang (kode wajib = satu barang, sama seperti Delphi pakai edtkode)
  query += `
    WHERE a.brg_aktif = 0 
      AND a.brg_logstok = 'Y'
  `;

  if (kodeBarang) {
    query += ` AND b.brgd_kode = ?`;
    params.push(kodeBarang);
  }

  // ORDER & GROUP persis
  query += `
    GROUP BY b.brgd_kode, b.brgd_ukuran
    ORDER BY b.brgd_kode, b.brgd_ukuran
  `;

  const [rows] = await pool.query(query, params);
  // ===============================
  // HITUNG SALDO AKHIR DI NODE
  // ===============================
  const result = rows.map((row) => {
    const stokAwal = Number(row.stokAwal || 0);
    const selisihSop = Number(row.selisihSop || 0);
    const koreksi = Number(row.koreksi || 0);
    const returJual = Number(row.returJual || 0);
    const terimaSJ = Number(row.terimaSJ || 0);
    const mutStoreTerima = Number(row.mutStoreTerima || 0);
    const mutInPesan = Number(row.mutInPesan || 0);

    const invoice = Number(row.invoice || 0);
    const returKeDC = Number(row.returKeDC || 0);
    const mutStoreKirim = Number(row.mutStoreKirim || 0);
    const mutOutPesan = Number(row.mutOutPesan || 0);

    const saldoAkhir =
      stokAwal +
      selisihSop +
      koreksi +
      returJual +
      terimaSJ +
      mutStoreTerima +
      mutInPesan -
      (invoice + returKeDC + mutStoreKirim + mutOutPesan);

    // DEBUG per baris
    console.log("==== DEBUG SALDO HEADER ====");
    console.log("ID      :", row.kode + row.ukuran);
    console.log("SAWAL   :", stokAwal);
    console.log("SOP     :", selisihSop);
    console.log("KOR     :", koreksi);
    console.log("RJ      :", returJual);
    console.log("TJ      :", terimaSJ);
    console.log("MST IN  :", mutStoreTerima);
    console.log("MSI IN  :", mutInPesan);
    console.log("INV     :", invoice);
    console.log("RB OUT  :", returKeDC);
    console.log("MSK OUT :", mutStoreKirim);
    console.log("MSO OUT :", mutOutPesan);
    console.log("SALDO   :", saldoAkhir);

    return {
      ...row,
      invoice,
      saldoAkhir,
    };
  });

  return result;
};

// ------------------------------------------------------
// 2. DETAIL / KARTU STOK (PER KODE+UKURAN) - STORE
// ------------------------------------------------------
const getKartuDetails = async (filters) => {
  const { gudang, startDate, endDate, id } = filters;

  if (!gudang || !startDate || !endDate || !id) {
    throw new Error("gudang, startDate, endDate, dan id harus diisi");
  }

  // Samakan periode dengan Delphi juga
  const { jenis, dawal, startDateEff } = await resolvePeriode(
    gudang,
    startDate
  );

  const start = parseISO(startDateEff);
  const end = parseISO(endDate);

  const startDateStr = format(start, "yyyy-MM-dd");
  const endDateStr = format(end, "yyyy-MM-dd");
  const startMinus1Str = format(subDays(start, 1), "yyyy-MM-dd");
  const startPlus1Str = format(addDays(start, 1), "yyyy-MM-dd");

  console.log(">>> DETAIL DEBUG");
  console.log("jenis =", jenis);
  console.log("dawal =", dawal);
  console.log("startDateEff =", startDateEff);
  console.log("startMinus1Str =", startMinus1Str);
  console.log("startPlus1Str =", startPlus1Str);

  // === STOK AWAL: sesuaikan dengan jenis (sama Delphi) ===
  let stokAwalQuery = "";
  let stokAwalParams = [];

  if (jenis === 0) {
    // Dari SOP pada tanggal Dawal
    stokAwalQuery = `
      SELECT
        ? AS id,
        m.mst_tanggal AS tanggal,
        'STOK AWAL' AS nomor,
        IFNULL(SUM(m.mst_stok_in), 0) AS \`In\`,
        0 AS \`Out\`,
        'Stok Awal' AS transaksi
      FROM tmasterstok m
      WHERE MID(m.mst_noreferensi,5,3) = 'SOP'
        AND m.mst_tanggal = ?
        AND LEFT(m.mst_noreferensi,3) = ?
        AND CONCAT(m.mst_brg_kode, m.mst_ukuran) = ?
      GROUP BY m.mst_brg_kode, m.mst_ukuran, m.mst_tanggal
    `;
    stokAwalParams = [id, dawal, gudang, id];
  } else {
    // Akumulasi dari Dawal s/d startDateEff-1
    stokAwalQuery = `
      SELECT
        ? AS id,
        ? AS tanggal,
        'STOK AWAL' AS nomor,
        IFNULL(SUM(m.mst_stok_in - m.mst_stok_out), 0) AS \`In\`,
        0 AS \`Out\`,
        'Stok Awal' AS transaksi
      FROM tmasterstok m
      WHERE m.mst_tanggal BETWEEN ? AND ?
        AND LEFT(m.mst_noreferensi,3) = ?
        AND CONCAT(m.mst_brg_kode, m.mst_ukuran) = ?
      GROUP BY m.mst_brg_kode, m.mst_ukuran
    `;
    stokAwalParams = [id, dawal, dawal, startMinus1Str, gudang, id];
  }

  // === MUTASI SELAMA PERIODE (non SOP) - versi STORE Delphi ===
  const mutasiQuery = `
    SELECT 
      CONCAT(m.mst_brg_kode, m.mst_ukuran) AS id,
      m.mst_tanggal AS tanggal,
      m.mst_noreferensi AS nomor,
      COALESCE(SUM(m.mst_stok_in), 0) AS \`In\`,
      COALESCE(SUM(m.mst_stok_out), 0) AS \`Out\`,
      CASE
          WHEN m.mst_noreferensi LIKE '%KOR%' THEN 'Koreksi'
          WHEN m.mst_noreferensi LIKE '%RJ%'  THEN 'Retur Jual'
          WHEN m.mst_noreferensi LIKE '%TJ%'  THEN 'Terima SJ'
          WHEN m.mst_noreferensi LIKE '%MST%' THEN 'Mutasi Store Terima'
          WHEN m.mst_noreferensi LIKE '%MSI%' THEN 'Mutasi in Pesanan'
          WHEN m.mst_noreferensi LIKE '%INV%' THEN 'Invoice'
          WHEN m.mst_noreferensi LIKE '%RB%'  THEN 'Retur Barang ke DC'
          WHEN m.mst_noreferensi LIKE '%MSK%' THEN 'Mutasi Store Kirim'
          WHEN m.mst_noreferensi LIKE '%MO%'  THEN 'Mutasi Out ke Produksi'
          WHEN m.mst_noreferensi LIKE '%MSO%' THEN 'Mutasi Stok ke Pesanan'
          ELSE 'Lain-lain'
      END AS transaksi
    FROM tmasterstok m
    WHERE m.mst_aktif = 'Y'
      AND MID(m.mst_noreferensi,5,3) <> 'SOP'
      AND m.mst_cab = ?
      AND m.mst_tanggal BETWEEN ? AND ?
      AND CONCAT(m.mst_brg_kode, m.mst_ukuran) = ?
    GROUP BY m.mst_brg_kode, m.mst_ukuran, m.mst_noreferensi, m.mst_tanggal
  `;
  const mutasiParams = [gudang, startDateStr, endDateStr, id];

  // === SELISIH SOP SELAMA PERIODE (startDate+1 s/d endDate) ===
  const sopQuery = `
    SELECT
      CONCAT(d.sopd_kode, d.sopd_ukuran) AS id,
      h.sop_tanggal AS tanggal,
      d.sopd_nomor AS nomor,
      COALESCE(d.sopd_selisih, 0) AS \`In\`,
      0 AS \`Out\`,
      'Selisih Stok Opname' AS transaksi
    FROM tsop_hdr h
    LEFT JOIN tsop_dtl d ON d.sopd_nomor = h.sop_nomor
    WHERE h.sop_tanggal BETWEEN ? AND ?
      AND LEFT(d.sopd_nomor, 3) = ?
      AND CONCAT(d.sopd_kode, d.sopd_ukuran) = ?
    GROUP BY d.sopd_kode, d.sopd_ukuran, d.sopd_nomor, h.sop_tanggal
  `;
  const sopParams = [startPlus1Str, endDateStr, gudang, id];

  // Gabungkan
  const fullQuery = `
    (${stokAwalQuery})
    UNION ALL
    (${mutasiQuery})
    UNION ALL
    (${sopQuery})
    ORDER BY tanggal, nomor
  `;

  const params = [...stokAwalParams, ...mutasiParams, ...sopParams];

  const [rows] = await pool.query(fullQuery, params);

  // Hitung saldo berjalan
  let saldo = 0;
  const resultWithSaldo = rows.map((row) => {
    const masuk = row.In || row.in || 0;
    const keluar = row.Out || row.out || 0;
    saldo += masuk - keluar;
    return { ...row, saldo };
  });

  return resultWithSaldo;
};

const getMutationDetails = async (filters) => {
  const {
    startDate,
    endDate,
    gudang,
    gudangDc: gudangDcStr,
    kodeProduk,
  } = filters;
  const gudangDc = parseInt(gudangDcStr, 10);

  // --- Logika Penentuan Tanggal Awal dari Delphi ---
  let d_awal = startDate;
  let jenis = 1;
  if (gudang && gudang !== "ALL") {
    const [gudangRows] = await pool.query(
      "SELECT gdg_last_sop, gdg_lastSopOld FROM tgudang WHERE gdg_kode = ?",
      [gudang]
    );
    if (gudangRows.length > 0) {
      const { gdg_last_sop, gdg_lastSopOld } = gudangRows[0];
      if (gdg_last_sop && !gdg_lastSopOld) {
        if (new Date(startDate) < new Date(gdg_last_sop)) {
          d_awal = format(new Date(gdg_last_sop), "yyyy-MM-dd");
          jenis = 0;
        }
      } else if (gdg_last_sop && gdg_lastSopOld) {
        if (new Date(startDate) <= new Date(gdg_lastSopOld)) {
          d_awal = format(new Date(gdg_lastSopOld), "yyyy-MM-dd");
          jenis = 0;
        } else if (
          new Date(startDate) > new Date(gdg_lastSopOld) &&
          new Date(startDate) < new Date(gdg_last_sop)
        ) {
          d_awal = format(new Date(gdg_lastSopOld), "yyyy-MM-dd");
          jenis = 1;
        } else if (new Date(startDate) >= new Date(gdg_last_sop)) {
          d_awal = format(new Date(gdg_last_sop), "yyyy-MM-dd");
          jenis = 1;
        }
      }
    }
  }
  // --- Akhir Logika Tanggal Awal ---

  // Hitung tanggal untuk query
  const dawalPlus1 = format(addDays(new Date(d_awal), 1), "yyyy-MM-dd");
  const startDateMinus1 = format(subDays(new Date(startDate), 1), "yyyy-MM-dd");

  let query = "";
  let params = [];
  let stockColumns = "",
    stockJoins = "",
    finalCalculation = "";

  const awalJoin =
    jenis === 0
      ? `LEFT JOIN (SELECT m.mst_brg_kode, m.mst_ukuran, SUM(m.mst_stok_in) AS stok FROM tmasterstok m WHERE m.mst_cab=? AND MID(m.mst_noreferensi,5,3)='SOP' AND m.mst_tanggal=? GROUP BY m.mst_brg_kode, m.mst_ukuran) awal ON awal.mst_brg_kode = b.brgd_kode AND awal.mst_ukuran = b.brgd_ukuran`
      : `LEFT JOIN (SELECT m.mst_brg_kode, m.mst_ukuran, SUM(m.mst_stok_in - m.mst_stok_out) AS stok FROM tmasterstok m WHERE m.mst_cab=? AND m.mst_tanggal >= ? AND m.mst_tanggal <= ? GROUP BY m.mst_brg_kode, m.mst_ukuran) awal ON awal.mst_brg_kode = b.brgd_kode AND awal.mst_ukuran = b.brgd_ukuran`;

  // Parameter untuk awal JOIN
  if (jenis === 0) {
    params = [gudang, d_awal];
  } else {
    params = [gudang, d_awal, startDateMinus1];
  }

  if (gudangDc === 0 || gudangDc === 3) {
    // ======================== QUERY DETAIL UNTUK STORE ========================
    const otherJoinsParams = [
      gudang,
      dawalPlus1,
      endDate, // sop - PERBAIKAN: pakai dawalPlus1
      gudang,
      startDate,
      endDate, // kor
      gudang,
      startDate,
      endDate, // rj
      gudang,
      startDate,
      endDate, // tj
      gudang,
      startDate,
      endDate, // mst
      gudang,
      startDate,
      endDate, // msi
      gudang,
      startDate,
      endDate, // inv
      gudang,
      startDate,
      endDate, // invso
      gudang,
      startDate,
      endDate, // rb
      gudang,
      startDate,
      endDate, // msk
      gudang,
      startDate,
      endDate, // mso
    ];
    params.push(...otherJoinsParams);

    stockColumns = `COALESCE(awal.stok, 0) AS stokAwal, COALESCE(sop.stok, 0) AS selisihSop, COALESCE(kor.stok, 0) AS koreksi, COALESCE(rj.stok, 0) AS returJual, COALESCE(tj.stok, 0) AS terimaSJ, COALESCE(mst.stok, 0) AS mutStoreTerima, COALESCE(msi.stok, 0) AS mutInPesan, (COALESCE(inv.stok, 0) + COALESCE(invso.stok, 0)) AS invoice, COALESCE(rb.stok, 0) AS returKeDC, COALESCE(msk.stok, 0) AS mutStoreKirim, COALESCE(mso.stok, 0) AS mutOutPesan`;
    stockJoins = `${awalJoin}
            LEFT JOIN (SELECT d.sopd_kode, d.sopd_ukuran, SUM(d.sopd_selisih) AS stok FROM tsop_hdr h JOIN tsop_dtl d ON d.sopd_nomor=h.sop_nomor WHERE LEFT(h.sop_nomor,3)=? AND h.sop_tanggal BETWEEN ? AND ? GROUP BY d.sopd_kode, d.sopd_ukuran) sop ON sop.sopd_kode=b.brgd_kode AND sop.sopd_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,3)='KOR' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) kor ON kor.mst_brg_kode=b.brgd_kode AND kor.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,2)='RJ' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) rj ON rj.mst_brg_kode=b.brgd_kode AND rj.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,2)='TJ' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) tj ON tj.mst_brg_kode=b.brgd_kode AND tj.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,3)='MST' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) mst ON mst.mst_brg_kode=b.brgd_kode AND mst.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in) AS stok FROM tmasterstokso WHERE mst_cab=? AND MID(mst_noreferensi,4,3)='MSI' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) msi ON msi.mst_brg_kode=b.brgd_kode AND msi.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_out) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,3)='INV' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) inv ON inv.mst_brg_kode=b.brgd_kode AND inv.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_out) AS stok FROM tmasterstokso WHERE mst_cab=? AND MID(mst_noreferensi,5,3)='INV' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) invso ON invso.mst_brg_kode=b.brgd_kode AND invso.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_out) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,2)='RB' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) rb ON rb.mst_brg_kode=b.brgd_kode AND rb.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_out) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,3)='MSK' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) msk ON msk.mst_brg_kode=b.brgd_kode AND msk.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_out) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,4,3)='MSO' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) mso ON mso.mst_brg_kode=b.brgd_kode AND mso.mst_ukuran=b.brgd_ukuran
        `;
    finalCalculation = `((COALESCE(awal.stok, 0) + COALESCE(sop.stok, 0) + COALESCE(kor.stok, 0) + COALESCE(rj.stok, 0) + COALESCE(tj.stok, 0) + COALESCE(mst.stok, 0) + COALESCE(msi.stok, 0)) - (COALESCE(inv.stok, 0) + COALESCE(invso.stok, 0) + COALESCE(rb.stok, 0) + COALESCE(msk.stok, 0) + COALESCE(mso.stok, 0))) AS saldoAkhir`;
  } else {
    // ======================== QUERY DETAIL UNTUK GUDANG DC ========================
    const otherJoinsParams = [
      gudang,
      dawalPlus1,
      endDate, // sop - PERBAIKAN: pakai dawalPlus1
      gudang,
      startDate,
      endDate, // kor
      gudang,
      startDate,
      endDate, // mtsin
      gudang,
      startDate,
      endDate, // mut
    ];
    params.push(...otherJoinsParams);

    stockColumns = `COALESCE(awal.stok, 0) AS stokAwal, COALESCE(sop.stok, 0) AS selisihSop, COALESCE(kor.stok, 0) AS koreksi, COALESCE(mtsin.stok, 0) AS mutasiIn, COALESCE(mut.stok, 0) AS terimaQc, COALESCE(ts.stok, 0) AS terimaSTBJ, COALESCE(gt.stok, 0) AS terimaGdgRepair, COALESCE(rb.stok, 0) AS returStore, COALESCE(rj.stok, 0) AS returJual, COALESCE(bpb.stok, 0) AS bpb, COALESCE(mct.stok, 0) AS mct, COALESCE(sj.stok, 0) AS sj, COALESCE(qc.stok, 0) AS qc, COALESCE(mtsout.stok, 0) AS mutasiOut, COALESCE(inv.stok, 0) AS invoice, COALESCE(mck.stok, 0) AS mck`;
    stockJoins = `${awalJoin}
            LEFT JOIN (SELECT d.sopd_kode, d.sopd_ukuran, SUM(d.sopd_selisih) AS stok FROM tsop_hdr h JOIN tsop_dtl d ON d.sopd_nomor=h.sop_nomor WHERE LEFT(h.sop_nomor,3)=? AND h.sop_tanggal BETWEEN ? AND ? GROUP BY d.sopd_kode, d.sopd_ukuran) sop ON sop.sopd_kode=b.brgd_kode AND sop.sopd_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,3)='KOR' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) kor ON kor.mst_brg_kode=b.brgd_kode AND kor.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,3)='MTS' AND mst_mts='Y' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) mtsin ON mtsin.mst_brg_kode=b.brgd_kode AND mtsin.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,3)='MUT' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) mut ON mut.mst_brg_kode=b.brgd_kode AND mut.mst_ukuran=b.brgd_ukuran`;

    if (gudang === "KDC") {
      stockJoins += ` LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,2)='TS' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) ts ON ts.mst_brg_kode=b.brgd_kode AND ts.mst_ukuran=b.brgd_ukuran`;
      stockJoins += ` LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,2)='GT' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) gt ON gt.mst_brg_kode=b.brgd_kode AND gt.mst_ukuran=b.brgd_ukuran`;
      params.push(gudang, startDate, endDate, gudang, startDate, endDate);
    } else {
      stockJoins += ` LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,3)='MTS' and mst_mts='' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) ts ON ts.mst_brg_kode=b.brgd_kode AND ts.mst_ukuran=b.brgd_ukuran`;
      stockJoins += ` LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,3)='MTS' and mst_mts='T' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) gt ON gt.mst_brg_kode=b.brgd_kode AND gt.mst_ukuran=b.brgd_ukuran`;
      params.push(gudang, startDate, endDate, gudang, startDate, endDate);
    }

    const remainingParams = [
      gudang,
      startDate,
      endDate, // rb
      gudang,
      startDate,
      endDate, // rj
      gudang,
      startDate,
      endDate, // bpb
      gudang,
      startDate,
      endDate, // mct
      gudang,
      startDate,
      endDate, // sj
      gudang,
      startDate,
      endDate, // qc
      gudang,
      startDate,
      endDate, // mtsout
      gudang,
      startDate,
      endDate, // inv
      gudang,
      startDate,
      endDate, // mck
    ];
    params.push(...remainingParams);

    stockJoins += `
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,2)='RB' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) rb ON rb.mst_brg_kode=b.brgd_kode AND rb.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,2)='RJ' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) rj ON rj.mst_brg_kode=b.brgd_kode AND rj.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,3)='BPB' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) bpb ON bpb.mst_brg_kode=b.brgd_kode AND bpb.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,3)='MCT' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) mct ON mct.mst_brg_kode=b.brgd_kode AND mct.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_out) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,2)='SJ' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) sj ON sj.mst_brg_kode=b.brgd_kode AND sj.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_out) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,2)='QC' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) qc ON qc.mst_brg_kode=b.brgd_kode AND qc.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_out) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,3)='MTS' AND mst_mts='Y' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) mtsout ON mtsout.mst_brg_kode=b.brgd_kode AND mtsout.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_out) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,3)='INV' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) inv ON inv.mst_brg_kode=b.brgd_kode AND inv.mst_ukuran=b.brgd_ukuran
            LEFT JOIN (SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_out) AS stok FROM tmasterstok WHERE mst_cab=? AND MID(mst_noreferensi,5,3)='MCK' AND mst_tanggal BETWEEN ? AND ? GROUP BY mst_brg_kode, mst_ukuran) mck ON mck.mst_brg_kode=b.brgd_kode AND mck.mst_ukuran=b.brgd_ukuran
        `;

    finalCalculation = `((COALESCE(awal.stok, 0) + COALESCE(sop.stok, 0) + COALESCE(kor.stok, 0) + COALESCE(mtsin.stok, 0) + COALESCE(mut.stok, 0) + COALESCE(rb.stok, 0) + COALESCE(rj.stok, 0) + COALESCE(ts.stok, 0) + COALESCE(gt.stok, 0) + COALESCE(bpb.stok, 0) + COALESCE(mct.stok, 0)) - (COALESCE(sj.stok, 0) + COALESCE(qc.stok, 0) + COALESCE(mtsout.stok, 0) + COALESCE(inv.stok, 0) + COALESCE(mck.stok, 0))) AS saldoAkhir`;
  }

  query = `SELECT b.brgd_ukuran AS ukuran, ${stockColumns}, ${finalCalculation} FROM tbarangdc_dtl b ${stockJoins} WHERE b.brgd_kode = ? GROUP BY b.brgd_ukuran ORDER BY b.brgd_ukuran;`;
  params.push(kodeProduk);

  console.log("QUERY:", query);
  console.log("PARAMS LENGTH:", params.length);
  console.log("FIRST 10 PARAMS:", params.slice(0, 10));
  console.log("TOTAL PLACEHOLDERS:", (query.match(/\?/g) || []).length);

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
