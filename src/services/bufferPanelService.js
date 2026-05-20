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
const getPreviewData = async (cabang) => {
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
    JOIN (
      SELECT mst_brg_kode, mst_ukuran
      FROM tmasterstok
      WHERE mst_aktif = 'Y' AND mst_cab = ?
      GROUP BY mst_brg_kode, mst_ukuran
      HAVING SUM(mst_stok_in - mst_stok_out) > 0
    ) stok ON stok.mst_brg_kode = b.brgd_kode AND stok.mst_ukuran = b.brgd_ukuran
    WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
      AND a.brg_ktgp = 'REGULER' 
    GROUP BY b.brgd_kode, b.brgd_ukuran
    ORDER BY nama, b.brgd_ukuran
  `,
    [cabang, cabang],
  );

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

    return {
      kode: row.kode,
      nama: row.nama,
      ukuran: row.ukuran,
      kategori: row.kategori_produk,
      avg_per_bulan: Math.round(avgPerBulan * 10) / 10,
      sales_kategori: salesKategori, // null jika pareto
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

// KDC version — agregat semua cabang
const getPreviewDataKDC = async () => {
  // Logika sama tapi tanpa filter cabang untuk avg penjualan
  // dan real_stok dari KDC stock
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth();

  const normalStart = new Date(curYear - 1, curMonth, 1);
  const normalEnd = new Date(curYear - 1, curMonth + 5, 0);
  const fmt = (d) => d.toISOString().slice(0, 10);

  const [skuRows] = await pool.query(`
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
          AND mst_cab = 'KDC'
          AND mst_aktif = 'Y'
      ), 0) - IFNULL((
        SELECT SUM(pld.pld_jumlah)
        FROM tpacking_list_dtl pld
        JOIN tpacking_list_hdr plh ON pld.pld_nomor = plh.pl_nomor
        WHERE pld.pld_kode = b.brgd_kode
          AND pld.pld_ukuran = b.brgd_ukuran
          AND plh.pl_status = 'O'
      ), 0) AS real_stok
    FROM tbarangdc a
    JOIN tbarangdc_dtl b ON a.brg_kode = b.brgd_kode
    WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
      AND a.brg_ktgp = 'REGULER' 
    GROUP BY b.brgd_kode, b.brgd_ukuran
    ORDER BY nama, b.brgd_ukuran
  `);

  const allKodes = [...new Set(skuRows.map((r) => r.kode))];

  // Avg semua cabang gabungan
  const [salesRows] = await pool.query(
    `
    SELECT d.invd_kode AS kode, d.invd_ukuran AS ukuran,
           SUM(d.invd_jumlah) AS total_terjual
    FROM tinv_dtl d
    JOIN tinv_hdr h ON h.inv_nomor = d.invd_inv_nomor
    WHERE h.inv_tanggal BETWEEN ? AND ?
      AND d.invd_kode IN (${allKodes.map(() => "?").join(",")})
    GROUP BY d.invd_kode, d.invd_ukuran
  `,
    [fmt(normalStart), fmt(normalEnd), ...allKodes],
  );

  const avgMap = {};
  salesRows.forEach((r) => {
    avgMap[`${r.kode}||${r.ukuran}`] = Number(r.total_terjual) / 5;
  });

  const result = skuRows.map((row) => {
    const key = `${row.kode}||${row.ukuran}`;
    const avgPerBulan = avgMap[key] ?? 0;
    const salesKategori = getSalesCategory(avgPerBulan);
    const bufferValue = getBufferValue(row.ukuran, salesKategori);

    return {
      kode: row.kode,
      nama: row.nama,
      ukuran: row.ukuran,
      kategori: row.kategori_produk,
      avg_per_bulan: Math.round(avgPerBulan * 10) / 10,
      sales_kategori: salesKategori,
      is_pareto: false,
      data_source: "tahun_lalu",
      buffer: bufferValue,
      min: bufferValue,
      max: bufferValue * 2,
      rop: Math.round(bufferValue * 0.7),
      real_stok: row.real_stok,
    };
  });

  return result;
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

const saveCalculatedBuffer = async (cabang, itemsArray) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const item of itemsArray) {
      const query =
        cabang === "KDC"
          ? `UPDATE tbarangdc_dtl SET brgd_mindc=?, brgd_maxdc=? WHERE brgd_kode=? AND brgd_ukuran=?`
          : `UPDATE tbarangdc_dtl SET brgd_min=?, brgd_max=? WHERE brgd_kode=? AND brgd_ukuran=?`;
      await connection.query(query, [
        item.min,
        item.max,
        item.kode,
        item.ukuran,
      ]);
    }
    await connection.commit();
    return { message: "Buffer Stok berhasil diperbarui." };
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

module.exports = {
  getPreviewData,
  getPreviewDataKDC,
  getConfig,
  saveConfig,
  saveCalculatedBuffer,
  getStokPerCabang,
  getSesionalItems,
  saveSesionalItems, // ← tambah
};
