const pool = require("../config/database");

// ── Tabel buffer per size ────────────────────────────────
const BUFFER_TABLE = {
  S: { small: 10, medium: 15, large: 20, xlarge: 30 },
  M: { small: 10, medium: 15, large: 20, xlarge: 30 },
  L: { small: 20, medium: 30, large: 40, xlarge: 60 },
  XL: { small: 20, medium: 30, large: 40, xlarge: 60 },
  "2XL": { small: 5, medium: 10, large: 15, xlarge: 20 },
  "3XL": { small: 5, medium: 10, large: 15, xlarge: 20 },
};

// Kode virtual untuk simulasi toko baru — TIDAK ADA di tgudang,
// murni untuk preview prediksi buffer sebelum toko fisiknya dibuka.
const VIRTUAL_NEW_STORE_KODE = "TOKO_BARU";

// [BARU] Nama barang yang TETAP di-nolkan buffernya kalau stok toko 0 —
// ini bahan pendukung/consumable, bukan barang jadi/kaos, jadi tidak
// relevan dipaksa punya buffer walau kategorinya REGULER. Dicocokkan
// via substring nama (bukan kode persis), supaya tetap match meski ada
// variasi kode untuk STICKER DTF / STICKER DTF PREMIUM yang belum
// terdaftar eksplisit.
const REGULER_ZERO_ON_NOSTOK_NAMA = [
  "EMBLEM BORDIR",
  "DTF METERAN",
  "STICKER DTF PREMIUM",
  "STICKER DTF",
];

// [BARU] Daftar toko reguler — dipakai untuk aturan khusus "barang reszo"
// (kode full angka seperti 2400016) yang TIDAK BOLEH dipasangi buffer
// sama sekali di toko-toko ini, meskipun brg_ktgp = REGULER.
const REGULER_STORE_LIST = [
  "K01",
  "K02",
  "K03",
  "K05",
  "K06",
  "K07",
  "K08",
  "K09",
  "K10",
  "K11",
  "K12",
];

// Deteksi kode barang RESZO (kode full angka, mis. "2400016", "2400021")
const isReszoKode = (kode) => /^\d+$/.test(kode);

// Fallback ukuran yang tidak ada di tabel → small
const getBufferValue = (ukuran, kategoriSales) => {
  const row = BUFFER_TABLE[ukuran] ?? {
    small: 5,
    medium: 10,
    large: 15,
    xlarge: 20,
  };
  return row[kategoriSales] ?? row.small;
};

// Threshold avg/bulan → kategori
const getSalesCategory = (avgPerBulan) => {
  if (avgPerBulan <= 0) return "small";
  if (avgPerBulan < 10) return "small";
  if (avgPerBulan < 15) return "medium";
  if (avgPerBulan < 20) return "large";
  return "xlarge";
};

// ── Ambil Daftar Cabang untuk Buffer Panel ────────────────
const getCabangList = async () => {
  const [rows] = await pool.query(
    `SELECT gdg_kode AS kode, gdg_nama AS nama 
     FROM tgudang 
     WHERE (gdg_dc = 0 OR gdg_kode IN ('KPR', 'KDC')) 
     ORDER BY gdg_kode`,
  );

  // [BARU] Tambahkan opsi Simulasi Toko Baru — BUKAN cabang asli di
  // tgudang, murni untuk kebutuhan prediksi/persiapan buffer sebelum toko
  // fisiknya dibuka.
  rows.push({
    kode: VIRTUAL_NEW_STORE_KODE,
    nama: "Simulasi Toko Baru",
  });

  return rows;
};

// ── Ambil pareto per jenis ───────────────────────────────
// Kembalikan Set kode barang yang masuk pareto
const getParetoKodes = async (cabang) => {
  const now = new Date();
  // Referensi pareto: 5 bulan dari bulan ini tahun lalu
  const startRef = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const endRef = new Date(now.getFullYear() - 1, now.getMonth() + 5, 0);
  const fmt = (d) => d.toISOString().slice(0, 10);

  // ── Top 10 PENDEK COMBED 24S ────────────────────────
  const [pendek] = await pool.query(
    `
    SELECT d.invd_kode AS kode, SUM(d.invd_jumlah) AS total
    FROM tinv_dtl d
    JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
    JOIN tbarangdc a ON a.brg_kode = d.invd_kode
    WHERE h.inv_tanggal BETWEEN ? AND ?
      AND h.inv_cab = ?
      AND UPPER(a.brg_lengan) LIKE '%PENDEK%'
      AND UPPER(a.brg_jeniskain) LIKE '%COMBED 24S%'
    GROUP BY d.invd_kode
    ORDER BY total DESC
    LIMIT 10
  `,
    [fmt(startRef), fmt(endRef), cabang],
  );

  // ── Top 10 PANJANG COMBED 24S ───────────────────────
  const [panjang] = await pool.query(
    `
    SELECT d.invd_kode AS kode, SUM(d.invd_jumlah) AS total
    FROM tinv_dtl d
    JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
    JOIN tbarangdc a ON a.brg_kode = d.invd_kode
    WHERE h.inv_tanggal BETWEEN ? AND ?
      AND h.inv_cab = ?
      AND UPPER(a.brg_lengan) LIKE '%PANJANG%'
      AND UPPER(a.brg_jeniskain) LIKE '%COMBED 24S%'
    GROUP BY d.invd_kode
    ORDER BY total DESC
    LIMIT 10
  `,
    [fmt(startRef), fmt(endRef), cabang],
  );

  // ── Top 5 POLO/LACOS CVC ────────────────────────────
  const [polo] = await pool.query(
    `
    SELECT d.invd_kode AS kode, SUM(d.invd_jumlah) AS total
    FROM tinv_dtl d
    JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
    JOIN tbarangdc a ON a.brg_kode = d.invd_kode
    WHERE h.inv_tanggal BETWEEN ? AND ?
      AND h.inv_cab = ?
      AND (
        UPPER(a.brg_jeniskain) LIKE '%CVC%'
        AND (
          UPPER(a.brg_jeniskaos) LIKE '%POLO%'
          OR UPPER(a.brg_jeniskain) LIKE '%LACOS%'
        )
      )
    GROUP BY d.invd_kode
    ORDER BY total DESC
    LIMIT 5
  `,
    [fmt(startRef), fmt(endRef), cabang],
  );

  const paretoSet = new Set([
    ...pendek.map((r) => r.kode),
    ...panjang.map((r) => r.kode),
    ...polo.map((r) => r.kode),
  ]);

  return {
    paretoSet: new Set([
      ...pendek.map((r) => r.kode),
      ...panjang.map((r) => r.kode),
      ...polo.map((r) => r.kode),
    ]),
    pendekSet: new Set(pendek.map((r) => r.kode)),
    panjangSet: new Set(panjang.map((r) => r.kode)),
    poloSet: new Set(polo.map((r) => r.kode)),
  };
};

// [BARU] Top 10 barang terlaris GLOBAL (gabungan SEMUA cabang, bukan per
// toko seperti getParetoKodes) — dasar kategori "large" untuk simulasi
// toko baru. Pakai periode referensi yang sama (5 bulan musiman tahun
// lalu) supaya konsisten dengan logic pareto yang sudah ada.
const getTop10GlobalPareto = async () => {
  const now = new Date();
  const startRef = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const endRef = new Date(now.getFullYear() - 1, now.getMonth() + 5, 0);
  const fmt = (d) => d.toISOString().slice(0, 10);

  const [rows] = await pool.query(
    `
    SELECT d.invd_kode AS kode, SUM(d.invd_jumlah) AS total
    FROM tinv_dtl d
    JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
    JOIN tbarangdc a ON a.brg_kode = d.invd_kode
    WHERE h.inv_tanggal BETWEEN ? AND ?
      AND a.brg_ktgp = 'REGULER'
    GROUP BY d.invd_kode
    ORDER BY total DESC
    LIMIT 10
  `,
    [fmt(startRef), fmt(endRef)],
  );
  return new Set(rows.map((r) => r.kode));
};

// ── Helper: hitung avg/bulan penjualan per kode+ukuran ──
const getAvgSales = async (
  cabang,
  kodeList,
  startDate,
  endDate,
  jumlahBulan,
) => {
  if (!kodeList.length) return {};

  const placeholders = kodeList.map(() => "?").join(",");
  const [rows] = await pool.query(
    `
    SELECT d.invd_kode AS kode, d.invd_ukuran AS ukuran,
           SUM(d.invd_jumlah) AS total_terjual
    FROM tinv_dtl d
    JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
    WHERE h.inv_tanggal BETWEEN ? AND ?
      AND h.inv_cab = ?
      AND d.invd_kode IN (${placeholders})
    GROUP BY d.invd_kode, d.invd_ukuran
  `,
    [startDate, endDate, cabang, ...kodeList],
  );

  const result = {};
  rows.forEach((r) => {
    const key = `${r.kode}||${r.ukuran}`;
    result[key] = Number(r.total_terjual) / jumlahBulan;
  });
  return result;
};

// ── Main: getPreviewData ─────────────────────────────────
const getPreviewData = async (cabang, options = {}) => {
  const { requireStock = true, excludeKodes = [] } = options;
  const now = new Date();

  const curYear = now.getFullYear();
  const curMonth = now.getMonth(); // 0-based

  // === Periode normal: bulan ini s.d. +4 bulan, tahun lalu ===
  const normalStart = new Date(curYear - 1, curMonth, 1);
  const normalEnd = new Date(curYear - 1, curMonth + 5, 0); // akhir bulan ke-5

  // === Periode pareto: 5 bulan ke depan dari bulan ini, tahun lalu ===
  // (sama dengan normal, bedanya ditambah 20%)
  const paretoStart = normalStart;
  const paretoEnd = normalEnd;

  // === Periode fallback (toko baru / tanpa history tahun lalu): 5 bulan terakhir ===
  const fallbackEnd = new Date(curYear, curMonth, 0); // akhir bulan lalu
  const fallbackStart = new Date(curYear, curMonth - 5, 1); // 5 bulan ke belakang

  const fmt = (d) => d.toISOString().slice(0, 10);

  // Cek apakah cabang punya history penjualan tahun lalu
  const [[histCheck]] = await pool.query(
    `
    SELECT COUNT(*) AS cnt
    FROM tinv_hdr
    WHERE inv_cab = ?
      AND inv_tanggal BETWEEN ? AND ?
  `,
    [cabang, fmt(normalStart), fmt(normalEnd)],
  );

  const hasLastYearHistory = histCheck.cnt > 0;

  // Cek toko baru (tidak ada penjualan sama sekali)
  const [[newStoreCheck]] = await pool.query(
    `
    SELECT COUNT(*) AS cnt FROM tinv_hdr WHERE inv_cab = ?
  `,
    [cabang],
  );
  const isNewStore = newStoreCheck.cnt === 0;

  // Ambil semua SKU yang ada stok di cabang ini
  const skuRowsRaw = await getEligibleSkus(cabang, requireStock, excludeKodes);

  // [BARU] KPR & Simulasi Toko Baru: barang RESZO (kode full angka) TIDAK
  // dihitung sama sekali — bukan barang jual/display normal, jadi tidak
  // relevan sebagai demand di dua konteks ini.
  const isReszoExcludedCabang =
    cabang === "KPR" || cabang === VIRTUAL_NEW_STORE_KODE;
  const skuRows = isReszoExcludedCabang
    ? skuRowsRaw.filter((r) => !isReszoKode(r.kode))
    : skuRowsRaw;

  const allKodes = [...new Set(skuRows.map((r) => r.kode))];

  // Ambil pareto
  const { paretoSet, pendekSet, panjangSet, poloSet } =
    await getParetoKodes(cabang);

  // Ambil avg penjualan sesuai kondisi
  let avgMap = {};

  if (isNewStore) {
    // Toko baru: semua small, avgMap kosong
    avgMap = {};
  } else if (!hasLastYearHistory) {
    // Tidak ada history tahun lalu: pakai 5 bulan terakhir
    avgMap = await getAvgSales(
      cabang,
      allKodes,
      fmt(fallbackStart),
      fmt(fallbackEnd),
      5,
    );
  } else {
    // Normal: pakai 5 bulan tahun lalu
    avgMap = await getAvgSales(
      cabang,
      allKodes,
      fmt(normalStart),
      fmt(normalEnd),
      5,
    );
  }

  // Untuk pareto: ambil data khusus (5 bulan ke depan tahun lalu + 20%)
  // Hanya jika ada history tahun lalu
  let paretoAvgMap = {};
  if (!isNewStore && hasLastYearHistory && paretoSet.size > 0) {
    const paretoKodes = [...paretoSet].filter((k) => allKodes.includes(k));
    paretoAvgMap = await getAvgSales(
      cabang,
      paretoKodes,
      fmt(paretoStart),
      fmt(paretoEnd),
      5,
    );

    // +20% diterapkan DI SINI — pastikan hanya sekali
    Object.keys(paretoAvgMap).forEach((k) => {
      paretoAvgMap[k] = paretoAvgMap[k] * 1.2;
    });
  }

  // Rakit hasil akhir
  const result = skuRows.map((row) => {
    const key = `${row.kode}||${row.ukuran}`;
    const isPareto = paretoSet.has(row.kode);

    let avgPerBulan = 0;
    let dataSource = "normal";

    if (isNewStore) {
      avgPerBulan = 0;
      dataSource = "toko_baru";
    } else if (isPareto && paretoAvgMap[key] !== undefined) {
      avgPerBulan = paretoAvgMap[key]; // sudah +20%
      dataSource = avgPerBulan >= 10 ? "pareto" : "pareto_small";
    } else {
      avgPerBulan = avgMap[key] ?? 0;
      dataSource = hasLastYearHistory ? "tahun_lalu" : "fallback_5bln";
    }

    // ── Buffer berbeda untuk pareto vs non-pareto ──────
    let salesKategori = null;
    let bufferValue = 0;

    if (isPareto) {
      if (avgPerBulan >= 10) {
        // Buffer = avg/bulan + 20%, dibulatkan ke atas
        bufferValue = Math.ceil(avgPerBulan);
        salesKategori = null; // tidak pakai kategori tabel
      } else {
        // Ukuran ini penjualannya kecil → tetap pakai tabel, masuk small
        salesKategori = "small";
        bufferValue = getBufferValue(row.ukuran, "small");
        // Tandai tetap pareto di pareto_group, tapi sales_kategori diisi
      }
    } else {
      salesKategori = getSalesCategory(avgPerBulan);
      bufferValue = getBufferValue(row.ukuran, salesKategori);
    }

    if (bufferValue !== 5) {
      bufferValue = Math.round(bufferValue * 0.5);
    }

    // [UBAH] Sebelumnya SEMUA item dengan stok toko 0 selalu dinolkan
    // buffernya. Sekarang: buffer TETAP terpasang meski stok 0 — KECUALI
    // untuk barang pendukung tertentu (EMBLEM BORDIR, DTF METERAN,
    // STICKER DTF, STICKER DTF PREMIUM) yang memang tidak relevan dipaksa
    // punya buffer per toko.
    const isStockZeroExemptItem = REGULER_ZERO_ON_NOSTOK_NAMA.some((n) =>
      (row.nama || "").toUpperCase().includes(n),
    );

    if (requireStock && isStockZeroExemptItem && Number(row.real_stok) === 0) {
      bufferValue = 0;
    }

    // [BARU] Barang RESZO — kode barang berupa angka murni (mis. "2400016")
    // TIDAK BOLEH dipasangi buffer di toko-toko reguler (K01–K12), meskipun
    // brg_ktgp-nya REGULER. Barang jenis ini bukan barang display/jual
    // normal per toko.
    if (REGULER_STORE_LIST.includes(cabang) && isReszoKode(row.kode)) {
      bufferValue = 0;
    }

    return {
      kode: row.kode,
      nama: row.nama,
      ukuran: row.ukuran,
      kategori: row.kategori_produk,
      avg_per_bulan: Math.round(avgPerBulan * 10) / 10,
      sales_kategori: salesKategori,
      is_pareto: isPareto,
      pareto_group: pendekSet.has(row.kode)
        ? "pendek"
        : panjangSet.has(row.kode)
          ? "panjang"
          : poloSet.has(row.kode)
            ? "polo"
            : null,
      data_source: dataSource,
      buffer: bufferValue,
      min: bufferValue,
      max: bufferValue * 2,
      rop: Math.round(bufferValue * 0.7),
      real_stok: row.real_stok,
    };
  });

  return result;
};

// Kode barang yang DIKECUALIKAN dari perhitungan buffer KPR &
// Simulasi Toko Baru — DTF METERAN & EMBLEM BORDIR bukan barang jadi/kaos,
// tidak relevan sebagai demand di konteks toko murni penjualan/simulasi.
const EXCLUDED_KODES_VIRTUAL_CABANG = ["2600050", "2600019"];

// KDC version — 1,5x lipat dari jumlah semua buffer toko
const getPreviewDataKDC = async (kprDataOverride = null) => {
  // [BARU] Ambil demand KPR — dipakai HANYA untuk menambah beban
  // perhitungan buffer KDC. KPR sendiri TIDAK pernah dipasangi buffer
  // stok (tidak disimpan ke tbarangdc_dtl2 untuk cabang KPR).
  let kprData = kprDataOverride;
  if (kprData === null) {
    try {
      kprData = await getPreviewData("KPR", {
        requireStock: false,
        excludeKodes: EXCLUDED_KODES_VIRTUAL_CABANG,
      });
    } catch (error) {
      console.error("[BUFFER KDC] Gagal ambil data KPR:", error.message);
      kprData = [];
    }
  }
  const kprMap = new Map();
  kprData.forEach((item) => {
    kprMap.set(`${item.kode}||${item.ukuran}`, item);
  });

  const [rows] = await pool.query(`
    SELECT 
      b.brgd_kode AS kode,
      b.brgd_ukuran AS ukuran,
      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
      CASE 
        WHEN a.brg_ktgp = 'REGULER' THEN 'reg'
        WHEN a.brg_ktgp = 'SESIONAL' THEN 'sea'
        WHEN a.brg_ktgp = 'PESANAN' THEN 'ord'
        ELSE 'lainnya'
      END AS kategori,
      IFNULL(SUM(d2.brgd_min), 0) AS total_min_toko,
      IFNULL(SUM(d2.brgd_max), 0) AS total_max_toko,
      IFNULL((
        SELECT SUM(mst_stok_in - mst_stok_out)
        FROM tmasterstok
        WHERE mst_brg_kode = b.brgd_kode
          AND mst_ukuran = b.brgd_ukuran
          AND mst_cab = 'KDC'
          AND mst_aktif = 'Y'
      ), 0) - IFNULL((
        SELECT SUM(pld.pld_jumlah)
        FROM tpacking_list_dtl pld
        JOIN tpacking_list_hdr plh ON pld.pld_nomor = plh.pl_nomor
        WHERE pld.pld_kode = b.brgd_kode
          AND pld.pld_ukuran = b.brgd_ukuran
          AND plh.pl_status = 'O'
      ), 0) AS real_stok,
      IFNULL((
        SELECT SUM(sub_spk.qty_sisa)
        FROM (
          SELECT 
            spkd.spkd_kode, 
            spkd.spkd_ukuran,
            (spkd.spkd_qtyorder - IFNULL(SUM(stb.stbjd_jumlah), 0)) AS qty_sisa
          FROM kencanaprint.tspk_dc spkd
          JOIN kencanaprint.tspk spk ON spk.spk_nomor = spkd.spkd_nomor
          LEFT JOIN kencanaprint.tstbj_dtl stb ON stb.stbjd_spk_nomor = spkd.spkd_nomor 
                AND stb.stbjd_size = spkd.spkd_ukuran
          WHERE spk.spk_aktif = 'Y' 
            AND spk.spk_close = 0
            AND YEAR(spk.spk_tanggal) >= 2026
            AND spk.user_create IN ('ADIN', 'LUTFI')
          GROUP BY spkd.spkd_nomor, spkd.spkd_ukuran
          HAVING qty_sisa > 0
        ) AS sub_spk
        WHERE sub_spk.spkd_kode = b.brgd_kode
          AND sub_spk.spkd_ukuran = b.brgd_ukuran
      ), 0) AS spk_beredar
    FROM tbarangdc a
    JOIN tbarangdc_dtl b ON a.brg_kode = b.brgd_kode
    LEFT JOIN tbarangdc_dtl2 d2 ON d2.brgd_kode = b.brgd_kode AND d2.brgd_ukuran = b.brgd_ukuran
    WHERE a.brg_aktif = 0 
      AND a.brg_logstok = 'Y'
      AND a.brg_ktgp = 'REGULER'
      AND UPPER(a.brg_warna) NOT LIKE '%STICKER%'
      AND UPPER(a.brg_warna) NOT LIKE '%EMBLEM%'
      AND b.brgd_ukuran NOT IN ('ALLSIZE', 'XS', '4XL', '5XL', '6XL', '7XL', '8XL', '9XL', '10XL', 'OVERSIZE', 'JUMBO') 
    GROUP BY b.brgd_kode, b.brgd_ukuran
    ORDER BY nama, b.brgd_ukuran
  `);

  return rows.map((row) => {
    const key = `${row.kode}||${row.ukuran}`;
    const kpr = kprMap.get(key);

    // [BARU] Tambahkan demand KPR ke total sebelum dikali 1.5x
    const totalMinToko = Number(row.total_min_toko) + (kpr ? kpr.min : 0);
    const totalMaxToko = Number(row.total_max_toko) + (kpr ? kpr.max : 0);

    const mindc = Math.ceil(totalMinToko * 1.5);
    const maxdc = Math.ceil(totalMaxToko * 1.5);

    return {
      kode: row.kode,
      nama: row.nama,
      ukuran: row.ukuran,
      kategori: row.kategori,
      buffer: mindc,
      min: mindc,
      max: maxdc,
      real_stok: row.real_stok,
      spk_beredar: row.spk_beredar,
    };
  });
};

// ── Ambil daftar periode (bulan) yang punya histori log buffer ──
const getPeriodeOptions = async () => {
  const [rows] = await pool.query(`
    SELECT log_periode AS periode FROM tbuffer_log_toko
    UNION
    SELECT log_periode AS periode FROM tbuffer_log_kdc
    ORDER BY periode DESC
  `);
  return rows.map((r) => r.periode);
};

// ── Histori buffer TOKO untuk periode tertentu (snapshot beku, BUKAN
// hitung ulang — real_stok null karena histori tidak menyimpan stok
// aktual saat itu, hanya angka buffer yang disimpan cron) ──
const getHistoricalBufferToko = async (cabang, periode) => {
  const [rows] = await pool.query(
    `
    SELECT 
      l.log_kode AS kode,
      l.log_ukuran AS ukuran,
      TRIM(CONCAT(a.brg_jeniskaos,' ',a.brg_tipe,' ',a.brg_lengan,' ',a.brg_jeniskain,' ',a.brg_warna)) AS nama,
      l.log_min AS min,
      l.log_max AS max
    FROM tbuffer_log_toko l
    LEFT JOIN tbarangdc a ON a.brg_kode = l.log_kode
    WHERE l.log_cabang = ? AND l.log_periode = ?
    ORDER BY nama, l.log_ukuran
  `,
    [cabang, periode],
  );
  return rows.map((r) => ({
    kode: r.kode,
    nama: r.nama || r.kode,
    ukuran: r.ukuran,
    kategori: "reg",
    avg_per_bulan: null,
    sales_kategori: null,
    is_pareto: false,
    pareto_group: null,
    data_source: "histori",
    buffer: r.min,
    min: r.min,
    max: r.max,
    rop: Math.round(r.min * 0.7),
    real_stok: null,
  }));
};

// ── Histori buffer KDC untuk periode tertentu ──
const getHistoricalBufferKdc = async (periode) => {
  const [rows] = await pool.query(
    `
    SELECT 
      l.log_kode AS kode,
      l.log_ukuran AS ukuran,
      TRIM(CONCAT(a.brg_jeniskaos,' ',a.brg_tipe,' ',a.brg_lengan,' ',a.brg_jeniskain,' ',a.brg_warna)) AS nama,
      l.log_mindc AS min,
      l.log_maxdc AS max
    FROM tbuffer_log_kdc l
    LEFT JOIN tbarangdc a ON a.brg_kode = l.log_kode
    WHERE l.log_periode = ?
    ORDER BY nama, l.log_ukuran
  `,
    [periode],
  );
  return rows.map((r) => ({
    kode: r.kode,
    nama: r.nama || r.kode,
    ukuran: r.ukuran,
    kategori: "reg",
    buffer: r.min,
    min: r.min,
    max: r.max,
    real_stok: null,
    spk_beredar: null,
  }));
};

// ── Dispatcher tunggal: pilih sumber data (live vs histori) sekaligus
// tujuan cabang (toko reguler / KDC / KPR / Simulasi Toko Baru).
// Dipakai bareng oleh endpoint preview biasa DAN export semua toko —
// supaya 1 sumber kebenaran, tidak ada logic switch yang keduplikasi.
const getPreviewForCabang = async (cabang, periode = null) => {
  if (periode) {
    // Histori TIDAK TERSEDIA untuk KPR & Simulasi Toko Baru — keduanya
    // memang tidak pernah disimpan ke tabel log oleh generateMonthlyLog.
    if (cabang === "KPR" || cabang === VIRTUAL_NEW_STORE_KODE) {
      return [];
    }
    if (cabang === "KDC") {
      return await getHistoricalBufferKdc(periode);
    }
    return await getHistoricalBufferToko(cabang, periode);
  }

  // Live — perilaku existing, TIDAK BERUBAH
  if (cabang === "KDC") {
    return await getPreviewDataKDC();
  }
  if (cabang === "KPR") {
    return await getPreviewData(cabang, {
      requireStock: false,
      excludeKodes: EXCLUDED_KODES_VIRTUAL_CABANG,
    });
  }
  if (cabang === VIRTUAL_NEW_STORE_KODE) {
    return await getPreviewDataNewStore();
  }
  return await getPreviewData(cabang);
};

// ── Export All Store — gabungkan SEMUA cabang (termasuk KDC, KPR,
// Simulasi Toko Baru) jadi 1 payload untuk export multi-sheet ──
const getAllCabangPreviewData = async (periode = null) => {
  const cabangList = await getCabangList(); // sudah termasuk KDC, KPR, TOKO_BARU
  const result = [];

  for (const cab of cabangList) {
    try {
      const items = await getPreviewForCabang(cab.kode, periode);
      result.push({ kode_cabang: cab.kode, nama_cabang: cab.nama, items });
    } catch (error) {
      console.error(
        `[EXPORT ALL] Gagal ambil data cabang ${cab.kode}:`,
        error.message,
      );
      result.push({
        kode_cabang: cab.kode,
        nama_cabang: cab.nama,
        items: [],
        error: error.message,
      });
    }
  }

  return result;
};

// Preview buffer untuk toko yang BELUM ADA fisiknya. Aturan simple:
// - Top 10 barang terlaris GLOBAL → kategori "large"
// - Sisanya → kategori "small"
// Tidak ada avg_per_bulan (karena belum ada histori penjualan toko ini),
// dan real_stok SELALU 0 (toko belum dibuka, belum ada barang sama sekali).
const getPreviewDataNewStore = async () => {
  const skuRowsRaw = await getEligibleSkus(
    VIRTUAL_NEW_STORE_KODE,
    false,
    EXCLUDED_KODES_VIRTUAL_CABANG,
  );

  // [BARU] Sama seperti KPR — barang RESZO tidak dihitung untuk simulasi toko baru
  const skuRows = skuRowsRaw.filter((r) => !isReszoKode(r.kode));

  const top10GlobalSet = await getTop10GlobalPareto();

  const result = skuRows.map((row) => {
    const isTopPareto = top10GlobalSet.has(row.kode);
    const salesKategori = isTopPareto ? "large" : "small";

    let bufferValue = getBufferValue(row.ukuran, salesKategori);

    // Reduksi 50% — konsisten dengan aturan toko normal (kecuali persis 5)
    if (bufferValue !== 5) {
      bufferValue = Math.round(bufferValue * 0.5);
    }

    return {
      kode: row.kode,
      nama: row.nama,
      ukuran: row.ukuran,
      kategori: row.kategori_produk,
      avg_per_bulan: 0,
      sales_kategori: salesKategori,
      is_pareto: isTopPareto,
      pareto_group: isTopPareto ? "top10_global" : null,
      data_source: "toko_baru",
      buffer: bufferValue,
      min: bufferValue,
      max: bufferValue * 2,
      rop: Math.round(bufferValue * 0.7),
      real_stok: 0,
    };
  });

  return result;
};

const getDetailSpkByItem = async (kode, ukuran) => {
  const [rows] = await pool.query(
    `
    SELECT spk_nomor, spk_nama, spk_tanggal, spk_dateline, qty_sisa AS spkd_qtyorder
    FROM (
      SELECT 
        spk.spk_nomor, 
        spk.spk_nama, 
        spk.spk_tanggal,
        spk.spk_dateline,
        (spkd.spkd_qtyorder - IFNULL(SUM(stb.stbjd_jumlah), 0)) AS qty_sisa
      FROM kencanaprint.tspk_dc spkd
      JOIN kencanaprint.tspk spk ON spk.spk_nomor = spkd.spkd_nomor
      JOIN tbarangdc a ON a.brg_kode = spkd.spkd_kode
      LEFT JOIN kencanaprint.tstbj_dtl stb ON stb.stbjd_spk_nomor = spkd.spkd_nomor 
            AND stb.stbjd_size = spkd.spkd_ukuran
      WHERE spkd.spkd_kode = ? 
        AND spkd.spkd_ukuran = ?
        AND spk.spk_aktif = 'Y'
        AND spk.spk_close = 0
        AND YEAR(spk.spk_tanggal) >= 2026
        AND spk.user_create IN ('ADIN', 'LUTFI')
      GROUP BY spkd.spkd_nomor, spkd.spkd_ukuran
      HAVING qty_sisa > 0
    ) AS detail_spk
    ORDER BY spk_tanggal DESC
    `,
    [kode, ukuran],
  );
  return rows;
};

// ── Fungsi lain tidak berubah ────────────────────────────
const getConfig = async (cabang) => {
  const [rows] = await pool.query(
    "SELECT * FROM tbuffer_config WHERE bfc_cab = ?",
    [cabang],
  );
  return rows[0] || null;
};

const saveConfig = async (cabang, cfg, user) => {
  const query = `
    INSERT INTO tbuffer_config (
      bfc_cab, bfc_lead_time, bfc_threshold, bfc_weight_terkini,
      bfc_sf_reg, bfc_al_reg, bfc_sf_sea, bfc_al_sea, bfc_sf_ord, bfc_al_ord,
      user_update, date_update
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      bfc_lead_time=VALUES(bfc_lead_time), bfc_threshold=VALUES(bfc_threshold),
      bfc_weight_terkini=VALUES(bfc_weight_terkini), bfc_sf_reg=VALUES(bfc_sf_reg),
      bfc_al_reg=VALUES(bfc_al_reg), bfc_sf_sea=VALUES(bfc_sf_sea),
      bfc_al_sea=VALUES(bfc_al_sea), bfc_sf_ord=VALUES(bfc_sf_ord),
      bfc_al_ord=VALUES(bfc_al_ord), user_update=VALUES(user_update), date_update=NOW()
  `;
  await pool.query(query, [
    cabang,
    cfg.leadTime,
    cfg.threshold,
    cfg.weightTerkini,
    cfg.sfReg,
    cfg.alReg,
    cfg.sfSea,
    cfg.alSea,
    cfg.sfOrd,
    cfg.alOrd,
    user,
  ]);
  return { message: "Parameter cabang berhasil disimpan." };
};

const saveCalculatedBuffer = async (cabang, itemsArray, userKode) => {
  if (cabang === "KPR" || cabang === VIRTUAL_NEW_STORE_KODE) {
    throw new Error(
      cabang === "KPR"
        ? "Cabang KPR tidak dapat dipasangi buffer stok sendiri. Penjualan KPR sudah otomatis diperhitungkan sebagai demand tambahan di buffer KDC."
        : "Simulasi Toko Baru hanya untuk preview — belum ada cabang fisiknya untuk dipasangi buffer.",
    );
  }

  if (!itemsArray || itemsArray.length === 0)
    return { message: "Tidak ada data untuk disimpan." };

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Pecah jadi batch agar ringan (1000 item per eksekusi)
    const batchSize = 1000;
    for (let i = 0; i < itemsArray.length; i += batchSize) {
      const batch = itemsArray.slice(i, i + batchSize);

      // Siapkan array data: [cabang, kode, ukuran, min, max, user, date]
      const values = batch.map((item) => [
        cabang,
        item.kode,
        item.ukuran,
        item.min,
        item.max,
        userKode || "SYS", // User update
        new Date(), // Date update
      ]);

      const query = `
        INSERT INTO tbarangdc_dtl2 
          (brgd_cab, brgd_kode, brgd_ukuran, brgd_min, brgd_max, user_update, date_update) 
        VALUES ?
        ON DUPLICATE KEY UPDATE 
          brgd_min = VALUES(brgd_min),
          brgd_max = VALUES(brgd_max),
          user_update = VALUES(user_update),
          date_update = VALUES(date_update)
      `;

      // Eksekusi Bulk
      await connection.query(query, [values]);
    }

    await connection.commit();
    return { message: "Buffer Stok per cabang berhasil diperbarui!" };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const saveCalculatedBufferKDC = async (itemsArray) => {
  if (!itemsArray || itemsArray.length === 0)
    return { message: "Tidak ada data KDC untuk disimpan." };

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // ── 1. [BARU] BERSIHKAN BUFFER BARANG NON-REGULER TERLEBIH DAHULU ──
    // Reset mindc & maxdc menjadi 0 untuk semua barang selain REGULER
    await connection.query(`
      UPDATE tbarangdc_dtl b
      JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
      SET b.brgd_mindc = 0, b.brgd_maxdc = 0
      WHERE IFNULL(a.brg_ktgp, '') != 'REGULER'
    `);

    // ── 2. UPDATE BUFFER BARANG REGULER HASIL KALKULASI ──
    const query = `
      UPDATE tbarangdc_dtl 
      SET brgd_mindc = ?, brgd_maxdc = ?
      WHERE brgd_kode = ? AND brgd_ukuran = ?
    `;

    for (const item of itemsArray) {
      await connection.query(query, [
        item.min,
        item.max,
        item.kode,
        item.ukuran,
      ]);
    }

    await connection.commit();
    return {
      message:
        "Buffer Stok KDC Pusat berhasil diperbarui & data non-reguler dibersihkan!",
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getStokPerCabang = async (kode, ukuran) => {
  const [rows] = await pool.query(
    `
    SELECT g.gdg_nama AS nama_cabang, g.gdg_kode AS kode_cabang,
           IFNULL(SUM(m.mst_stok_in - m.mst_stok_out), 0) AS stok
    FROM tgudang g
    LEFT JOIN tmasterstok m
      ON m.mst_brg_kode = ? AND m.mst_ukuran = ?
      AND m.mst_cab = g.gdg_kode AND m.mst_aktif = 'Y'
    GROUP BY g.gdg_kode, g.gdg_nama
    ORDER BY stok DESC
  `,
    [kode, ukuran],
  );
  return rows;
};

// Ambil barang sesional beserta kategori yang sudah disetting
const getSesionalItems = async (cabang) => {
  const [rows] = await pool.query(
    `
    SELECT 
      a.brg_kode AS kode,
      TRIM(REGEXP_REPLACE(
        CONCAT(a.brg_jeniskaos,' ',a.brg_tipe,' ',a.brg_lengan,' ',a.brg_jeniskain,' ',a.brg_warna),
        '\\\\s+', ' '
      )) AS nama,
      -- Ambil setting yang sudah ada (NULL jika belum pernah di-set)
      s.bsc_kategori AS sales_kategori
    FROM tbarangdc a
    LEFT JOIN tbuffer_sesional_config s
      ON s.bsc_kode = a.brg_kode
      AND s.bsc_cab = ?
    WHERE a.brg_aktif = 0
      AND a.brg_logstok = 'Y'
      AND a.brg_ktgp = 'SESIONAL'
    GROUP BY a.brg_kode, a.brg_jeniskaos, a.brg_tipe,
             a.brg_lengan, a.brg_jeniskain, a.brg_warna
    ORDER BY nama
  `,
    [cabang],
  );
  return rows;
};

const saveSesionalItems = async (cabang, items) => {
  // Hanya proses item yang sudah dipilih kategorinya
  const toSave = items.filter((i) => i.sales_kategori !== null);

  if (toSave.length === 0) {
    return { message: "Tidak ada perubahan yang disimpan." };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const item of toSave) {
      // Simpan satu record per kode (tanpa ukuran) — ukuran akan menyesuaikan saat kalkulasi
      await connection.query(
        `
        INSERT INTO tbuffer_sesional_config (bsc_cab, bsc_kode, bsc_ukuran, bsc_kategori)
        VALUES (?, ?, '*', ?)
        ON DUPLICATE KEY UPDATE bsc_kategori = VALUES(bsc_kategori)
      `,
        [cabang, item.kode, item.sales_kategori],
      );
    }

    await connection.commit();
    return { message: `${toSave.length} barang sesional berhasil disimpan.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// ── Helper: ambil daftar SKU yang layak dihitung buffer-nya ─
// requireStock=true  → SKU harus punya stok fisik > 0 di cabang tsb (perilaku lama, untuk toko normal)
// requireStock=false → SEMUA SKU REGULER aktif diikutkan tanpa syarat stok
//                       (dipakai KHUSUS untuk KPR, karena KPR tidak pernah
//                       menyimpan baris stok sendiri di tmasterstok — histori
//                       penjualannya tetap harus terhitung)
// excludeKodes       → [BARU] daftar kode barang yang DIKECUALIKAN sama sekali
//                       dari hasil (dipakai untuk KPR & Simulasi Toko Baru —
//                       DTF METERAN & EMBLEM BORDIR bukan barang jadi/kaos,
//                       tidak relevan dihitung sebagai demand buffer di
//                       konteks itu)
const getEligibleSkus = async (cabang, requireStock, excludeKodes = []) => {
  let excludeFilter = "";
  const params = [cabang];
  if (excludeKodes.length > 0) {
    excludeFilter = `AND b.brgd_kode NOT IN (${excludeKodes.map(() => "?").join(",")})`;
    params.push(...excludeKodes);
  }

  const [skuRows] = await pool.query(
    `
    SELECT 
      b.brgd_kode AS kode,
      TRIM(REGEXP_REPLACE(
        CONCAT(a.brg_jeniskaos,' ',a.brg_tipe,' ',a.brg_lengan,' ',a.brg_jeniskain,' ',a.brg_warna),
        '\\\\s+', ' '
      )) AS nama,
      b.brgd_ukuran AS ukuran,
      CASE 
        WHEN a.brg_ktgp = 'REGULER' THEN 'reg'
        WHEN a.brg_ktgp = 'SESIONAL' THEN 'sea'
        WHEN a.brg_ktgp = 'PESANAN' THEN 'ord'
        ELSE 'lainnya'
      END AS kategori_produk,
      IFNULL((
        SELECT SUM(mst_stok_in - mst_stok_out)
        FROM tmasterstok
        WHERE mst_brg_kode = b.brgd_kode
          AND mst_ukuran = b.brgd_ukuran
          AND mst_cab = ?
          AND mst_aktif = 'Y'
      ), 0) AS real_stok
    FROM tbarangdc a
    JOIN tbarangdc_dtl b ON a.brg_kode = b.brgd_kode
    WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
      AND a.brg_ktgp = 'REGULER' 
      AND b.brgd_ukuran NOT IN ('ALLSIZE', 'XS', '4XL', '5XL', '6XL', '7XL', '8XL', '9XL', '10XL', 'OVERSIZE', 'JUMBO') 
      ${excludeFilter}
    GROUP BY b.brgd_kode, b.brgd_ukuran
    ORDER BY nama, b.brgd_ukuran
  `,
    params,
  );
  return skuRows;
};

const generateMonthlyLog = async () => {
  const now = new Date();
  const periode = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // [UBAH] KPR dikecualikan dari loop toko biasa — KPR tidak dipasangi buffer
  const [cabangRows] = await pool.query(
    "SELECT gdg_kode FROM tgudang WHERE gdg_dc = 0 AND gdg_kode NOT IN ('KDC', 'KPR')",
  );

  const results = { success: [], failed: [] };

  // [FIX] Loop per cabang, transaksi terpisah per cabang — bukan 1 transaksi
  // raksasa yang menahan koneksi selama SELURUH proses berjalan.
  for (const cab of cabangRows) {
    const cabang = cab.gdg_kode;
    const startTime = Date.now();
    try {
      console.log(`[BUFFER CRON] Mulai proses cabang ${cabang}...`);
      const dataToko = await getPreviewData(cabang); // pakai pool, di luar transaksi — read-only aman

      if (dataToko && dataToko.length > 0) {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();

          const updateTokoValues = dataToko.map((item) => [
            cabang,
            item.kode,
            item.ukuran,
            item.min,
            item.max,
            "SYS-CRON",
            now,
          ]);
          await connection.query(
            `INSERT INTO tbarangdc_dtl2 (brgd_cab, brgd_kode, brgd_ukuran, brgd_min, brgd_max, user_update, date_update)
             VALUES ? 
             ON DUPLICATE KEY UPDATE 
               brgd_min=VALUES(brgd_min), brgd_max=VALUES(brgd_max), 
               user_update=VALUES(user_update), date_update=VALUES(date_update)`,
            [updateTokoValues],
          );

          const logTokoValues = dataToko.map((item) => [
            periode,
            cabang,
            item.kode,
            item.ukuran,
            item.min,
            item.max,
            now,
          ]);
          await connection.query(
            `INSERT INTO tbuffer_log_toko (log_periode, log_cabang, log_kode, log_ukuran, log_min, log_max, created_at)
             VALUES ?`,
            [logTokoValues],
          );

          await connection.commit();
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(
            `[BUFFER CRON] ✅ Cabang ${cabang} selesai (${elapsed}s, ${dataToko.length} item).`,
          );
          results.success.push(cabang);
        } catch (err) {
          await connection.rollback();
          throw err;
        } finally {
          connection.release();
        }
      } else {
        console.log(`[BUFFER CRON] Cabang ${cabang} tidak ada data (skip).`);
      }
    } catch (error) {
      console.error(
        `[BUFFER CRON] ❌ Gagal proses cabang ${cabang}:`,
        error.message,
      );
      results.failed.push({ cabang, error: error.message });
      // [FIX] Lanjut ke cabang berikutnya, jangan hentikan seluruh proses
    }
  }

  // [BARU] Hitung demand KPR terpisah — HANYA untuk KDC, tidak disimpan
  // sebagai buffer toko KPR sendiri
  let kprData = [];
  try {
    console.log(`[BUFFER CRON] Mulai hitung demand KPR (untuk KDC)...`);
    kprData = await getPreviewData("KPR", {
      requireStock: false,
      excludeKodes: EXCLUDED_KODES_VIRTUAL_CABANG,
    });
    console.log(`[BUFFER CRON] Demand KPR: ${kprData.length} item.`);
  } catch (error) {
    console.error(`[BUFFER CRON] Gagal hitung demand KPR:`, error.message);
    results.failed.push({ cabang: "KPR (demand only)", error: error.message });
  }

  // KDC — transaksi terpisah lagi, setelah semua toko selesai
  try {
    const dataKDC = await getPreviewDataKDC();
    if (dataKDC && dataKDC.length > 0) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        await connection.query(`
          UPDATE tbarangdc_dtl b
          JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
          SET b.brgd_mindc = 0, b.brgd_maxdc = 0
          WHERE IFNULL(a.brg_ktgp, '') != 'REGULER'
        `);

        for (const item of dataKDC) {
          await connection.query(
            `UPDATE tbarangdc_dtl SET brgd_mindc = ?, brgd_maxdc = ? WHERE brgd_kode = ? AND brgd_ukuran = ?`,
            [item.min, item.max, item.kode, item.ukuran],
          );
        }

        const logKdcValues = dataKDC.map((item) => [
          periode,
          item.kode,
          item.ukuran,
          item.min,
          item.max,
          now,
        ]);
        await connection.query(
          `INSERT INTO tbuffer_log_kdc (log_periode, log_kode, log_ukuran, log_mindc, log_maxdc, created_at) VALUES ?`,
          [logKdcValues],
        );

        await connection.commit();
        console.log(`[BUFFER CRON] ✅ KDC selesai (${dataKDC.length} item).`);
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    }
  } catch (error) {
    console.error(`[BUFFER CRON] ❌ Gagal proses KDC:`, error.message);
    results.failed.push({ cabang: "KDC", error: error.message });
  }

  console.log(
    `[BUFFER CRON] Selesai. Berhasil: ${results.success.length}, Gagal: ${results.failed.length}.`,
  );
  return {
    message: "Generate buffer log bulanan selesai dijalankan.",
    ...results,
  };
};

module.exports = {
  getCabangList,
  getPreviewData,
  getPreviewDataKDC,
  getPreviewDataNewStore,
  getPreviewForCabang,
  getPeriodeOptions,
  getAllCabangPreviewData,
  EXCLUDED_KODES_VIRTUAL_CABANG,
  getDetailSpkByItem,
  getConfig,
  saveConfig,
  saveCalculatedBuffer,
  saveCalculatedBufferKDC,
  getStokPerCabang,
  getSesionalItems,
  saveSesionalItems,
  generateMonthlyLog,
};
