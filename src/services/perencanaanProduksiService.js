const pool = require("../config/database");
const { format } = require("date-fns");

// --- Helper: generate nomor SO format MANKSI: SO-{perush}-{jo}-000001 ---
const generateSpkNomorSo = async (connection, perushKode, joKode) => {
  const prefix = `${perushKode}-${joKode}-`;
  const [rows] = await connection.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(spk_nomor, ?, 6) AS UNSIGNED)), 0) AS jumlah
     FROM kencanaprint.tspk
     WHERE spk_perush_kode = ? AND spk_jo_kode = ? AND spk_nomor LIKE ?
     FOR UPDATE`,
    [prefix.length + 1, perushKode, joKode, `${prefix}%`],
  );
  const nextVal = Number(rows[0].jumlah) + 1; // wajib Number() — cegah bug string concat
  return `${prefix}${String(nextVal).padStart(6, "0")}`;
};

const getPriorityData = async (filters) => {
  const { kategori, keyword, page = 1, itemsPerPage = 50 } = filters;
  const connection = await pool.getConnection();

  try {
    let filterParams = [];
    let searchFilter = "";
    let kategoriFilter = "";

    if (kategori && kategori !== "Semua") {
      kategoriFilter = " AND a.brg_ktgp = ? ";
      filterParams.push(kategori);
    }

    if (keyword && keyword.trim() !== "") {
      const searchTerm = `%${keyword.trim()}%`;
      searchFilter = ` AND (b.brgd_kode LIKE ? OR TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna)) LIKE ?)`;
      filterParams.push(searchTerm, searchTerm);
    }

    // 1. QUERY INTI: Menggunakan Derived Tables
    const baseQuery = `
      FROM tbarangdc a
      JOIN tbarangdc_dtl b ON a.brg_kode = b.brgd_kode
      
      -- Agregasi Stok DC
      LEFT JOIN (
          SELECT mst_brg_kode, mst_ukuran, SUM(mst_stok_in - mst_stok_out) AS stok_dc
          FROM tmasterstok 
          WHERE mst_cab = 'KDC' AND mst_aktif = 'Y'
          GROUP BY mst_brg_kode, mst_ukuran
      ) dc ON dc.mst_brg_kode = b.brgd_kode AND dc.mst_ukuran = b.brgd_ukuran

      -- Agregasi SPK Beredar (Aktif, belum masuk Jahit ke Lipat)
      LEFT JOIN (
          SELECT spkd.spkd_kode AS kode, spkd.spkd_ukuran AS ukuran,
                SUM(spkd.spkd_qtyorder) AS spk_beredar
          FROM kencanaprint.tspk_dc spkd
          JOIN kencanaprint.tspk spk ON spk.spk_nomor = spkd.spkd_nomor
          WHERE spk.spk_aktif = 'Y' 
            AND spk.spk_close = 0
            AND YEAR(spk.spk_tanggal) >= 2026
            -- Belum masuk STBJ sama sekali
            AND NOT EXISTS (
                SELECT 1 FROM kencanaprint.tstbj_dtl stb
                WHERE stb.stbjd_spk_nomor = spkd.spkd_nomor
                  AND stb.stbjd_size = spkd.spkd_ukuran
            )
          GROUP BY spkd.spkd_kode, spkd.spkd_ukuran
      ) beredar ON beredar.kode = b.brgd_kode AND beredar.ukuran = b.brgd_ukuran

      -- Agregasi Toko (Buffer, Stok, Gap Store)
      LEFT JOIN (
          SELECT 
              b2.brgd_kode, b2.brgd_ukuran,
              SUM(b2.brgd_min) AS total_buffer_store,
              SUM(IFNULL(mst.stok_aktual, 0)) AS total_stok_store,
              SUM(GREATEST(0, b2.brgd_min - IFNULL(mst.stok_aktual, 0))) AS gap_store
          FROM tbarangdc_dtl2 b2
          LEFT JOIN (
              SELECT mst_cab, mst_brg_kode, mst_ukuran, SUM(mst_stok_in - mst_stok_out) AS stok_aktual
              FROM tmasterstok 
              WHERE mst_aktif = 'Y' AND mst_cab != 'KDC'
              GROUP BY mst_cab, mst_brg_kode, mst_ukuran
          ) mst ON mst.mst_cab = b2.brgd_cab AND mst.mst_brg_kode = b2.brgd_kode AND mst.mst_ukuran = b2.brgd_ukuran
          GROUP BY b2.brgd_kode, b2.brgd_ukuran
      ) store ON store.brgd_kode = b.brgd_kode AND store.brgd_ukuran = b.brgd_ukuran

      WHERE a.brg_aktif = 0 
        AND a.brg_logstok = 'Y' 
        AND UPPER(a.brg_warna) NOT LIKE '%STICKER%'
        AND UPPER(a.brg_warna) NOT LIKE '%EMBLEM%'
        AND b.brgd_ukuran NOT IN ('ALLSIZE', 'XS', '4XL', '5XL', '6XL', '7XL', '8XL', '9XL', '10XL', 'OVERSIZE', 'JUMBO')
        ${kategoriFilter}
        ${searchFilter}
    `;

    // 2. PEMBUNGKUS KALKULASI UTAMA (Sesuai Rumus di Desain)
    const wrapperQuery = `
      SELECT 
        *,
        (stok_dc / daily_need) AS cvg_saat_ini,
        GREATEST(0, (buffer_dc + gap_store) - stok_dc) AS gap_buffer_dc
      FROM (
        SELECT 
          b.brgd_kode AS kode, b.brgd_ukuran AS ukuran,
          TRIM(CONCAT(a.brg_jeniskaos, ' ', a.brg_tipe, ' ', a.brg_lengan, ' ', a.brg_jeniskain, ' ', a.brg_warna)) AS nama,
          a.brg_lengan, a.brg_warna, a.brg_jeniskain, a.brg_jeniskaos,
          a.brg_ktgp AS kategori, b.brgd_hpp AS hpp,
          
          IFNULL((
            SELECT img_url 
            FROM tbarangdc_images 
            WHERE img_brg_kode = b.brgd_kode 
            ORDER BY img_index ASC LIMIT 1
          ), '') AS img_url,

          IFNULL(b.brgd_mindc, 0) AS buffer_dc,
          IFNULL(dc.stok_dc, 0) AS stok_dc,
          IFNULL(store.total_buffer_store, 0) AS buffer_store,
          IFNULL(store.total_stok_store, 0) AS stok_store,
          IFNULL(store.gap_store, 0) AS gap_store,
          IFNULL(beredar.spk_beredar, 0) AS spk_beredar,
          
          -- Daily Need: Gap Store / 30. Minimal 1 agar tidak Error Divide By Zero
          GREATEST((IFNULL(store.gap_store, 0) / 30), 1) AS daily_need
        ${baseQuery}
      ) AS raw_data
    `;

    // 3. HITUNG SUMMARY KARTU ATAS
    const summarySql = `
      SELECT 
        COUNT(*) AS total_items,
        SUM(stok_dc) AS total_stok_dc,
        SUM(CASE WHEN cvg_saat_ini < 7 THEN 1 ELSE 0 END) AS sku_kritis,
        SUM(CASE WHEN cvg_saat_ini >= 7 AND cvg_saat_ini <= 15 THEN 1 ELSE 0 END) AS sku_perhatian,
        SUM(CASE WHEN cvg_saat_ini > 15 THEN 1 ELSE 0 END) AS sku_aman
      FROM (${wrapperQuery}) AS summary_tbl
    `;
    const [summaryRows] = await connection.query(summarySql, filterParams);
    const summary = summaryRows[0];

    // 4. TERAPKAN PAGINATION
    let dataParams = [...filterParams];
    let paginationSql = "";

    if (parseInt(itemsPerPage) > 0) {
      const limit = parseInt(itemsPerPage);
      const offset = (parseInt(page) - 1) * limit;
      paginationSql = " LIMIT ? OFFSET ? ";
      dataParams.push(limit, offset);
    }

    const totalStokDC = summary.total_stok_dc || 0;
    const KAPASITAS_HARIAN = 1750;
    const coverageProduksi = Math.round(totalStokDC / KAPASITAS_HARIAN);

    const dataSql = `
      ${wrapperQuery}
      ORDER BY (buffer_dc > 0) DESC, cvg_saat_ini ASC, gap_buffer_dc DESC
      ${paginationSql}
    `;

    const [rows] = await connection.query(dataSql, dataParams);

    const items = rows.map((row, index) => {
      let status = "Aman";
      if (row.cvg_saat_ini < 7) status = "Kritis";
      else if (row.cvg_saat_ini <= 15) status = "Perlu Perhatian";

      return {
        ...row,
        status,
        brg_lengan: row.brg_lengan || "",
        brg_warna: row.brg_warna || "",
        brg_jeniskain: row.brg_jeniskain || "",
        brg_jeniskaos: row.brg_jeniskaos || "",
        cvg_saat_ini: Number(row.cvg_saat_ini).toFixed(1),
        daily_need: Number(row.daily_need).toFixed(1),
        rekomendasi_spk: Math.max(
          0,
          (row.gap_buffer_dc || 0) - (row.spk_beredar || 0),
        ),
        spk_beredar: row.spk_beredar || 0,
        ranking_asli:
          (parseInt(page) > 0
            ? (parseInt(page) - 1) * parseInt(itemsPerPage)
            : 0) +
          index +
          1,
      };
    });

    return {
      data: items,
      summary: {
        totalItems: summary.total_items,
        totalStokDC: totalStokDC,
        coverageProduksi: coverageProduksi,
        kapasitasHarian: KAPASITAS_HARIAN,
        skuKritis: summary.sku_kritis || 0,
        skuPerhatian: summary.sku_perhatian || 0,
        skuAman: summary.sku_aman || 0,
      },
    };
  } finally {
    connection.release();
  }
};

const getStoreDetails = async (kode, ukuran) => {
  const query = `
    SELECT 
        g.gdg_nama AS cabang_nama,
        b2.brgd_min AS buffer,
        IFNULL(SUM(m.mst_stok_in - m.mst_stok_out), 0) AS stok_aktual,
        (b2.brgd_min - IFNULL(SUM(m.mst_stok_in - m.mst_stok_out), 0)) AS kekurangan
    FROM tgudang g
    JOIN tbarangdc_dtl2 b2 ON b2.brgd_cab = g.gdg_kode
    LEFT JOIN tmasterstok m ON m.mst_cab = g.gdg_kode AND m.mst_brg_kode = b2.brgd_kode AND m.mst_ukuran = b2.brgd_ukuran AND m.mst_aktif = 'Y'
    WHERE b2.brgd_kode = ? 
      AND b2.brgd_ukuran = ? 
      AND g.gdg_kode != 'KDC' -- HANYA FILTER INI
    GROUP BY g.gdg_kode, b2.brgd_min
    HAVING kekurangan > 0
    ORDER BY kekurangan DESC
  `;
  const [rows] = await pool.query(query, [kode, ukuran]);
  return rows;
};

// --- Ekstrak jo_kode dari kode SKU (contoh: 'KO-C30S-HITM-005' -> 'KO') ---
// spk_jo_kode di DDL adalah varchar(2), jadi wajib dipotong maks 2 karakter
const extractJoKode = (kodeSku) => {
  if (!kodeSku) return "XX";
  const parts = String(kodeSku).split("-");
  return (parts[0] || "XX").substring(0, 2).toUpperCase();
};

// --- Tentukan jo_kode SPK: override khusus untuk Jaket/Hoodie & normalisasi LL→KO ---
const determineJoKode = (item, kodeBarang) => {
  const jeniskain = String(item.brg_jeniskain || "")
    .trim()
    .toUpperCase();
  if (
    jeniskain.includes("HOODIE FLEECE") ||
    jeniskain.includes("JAKET FLEECE")
  ) {
    return "JK";
  }

  const rawKode = extractJoKode(kodeBarang);

  // Kode barang LL (Jersey Spandek) tetap dicatat sebagai Jenis Order "KO"
  // di Sales Order MANKSI, walau kode barang aslinya berprefix LL.
  // (Deteksi penamaan "SPANDEK" tetap dilakukan terpisah di formatSpkNama
  // berdasarkan prefix kode barang asli, bukan dari nilai ini.)
  if (rawKode === "LL") {
    return "KO";
  }

  return rawKode;
};

// --- Konstanta konfigurasi ---
const PERUSH_KODE_DC = "SM";
const CAB_KODE_DC = "P04";
const CUS_KODE_DC = "DC";
const SAL_KODE_DC = "012";
const DIVISI_KAOSAN = 3;

// --- Format Nama SPK sesuai konvensi KAOSAN ---
const formatSpkNama = (item, joKode) => {
  const lengan = String(item.brg_lengan || "")
    .trim()
    .toUpperCase();
  const warna = String(item.brg_warna || "")
    .trim()
    .toUpperCase();
  const jeniskain = String(item.brg_jeniskain || "")
    .trim()
    .toUpperCase();
  const kodePrefixAsli = extractJoKode(item.kode); // prefix kode barang asli (sebelum normalisasi)
  const clean = (str) => str.replace(/\s+/g, " ").trim();

  if (!lengan && !warna && !jeniskain) {
    console.warn(
      `[formatSpkNama] Field mentah kosong untuk kode=${item.kode}. nama="${item.nama}"`,
    );
    return `KAOSAN ${String(item.nama || item.kode || "TANPA NAMA").toUpperCase()}`;
  }

  // 1. Jersey kode barang LL — sisip kata SPANDEK (template khusus)
  // Dicek dari PREFIX KODE BARANG ASLI, bukan dari joKode (yang sudah dinormalisasi ke KO)
  if (kodePrefixAsli === "LL" && lengan.includes("JERSEY")) {
    return clean(`KAOSAN POLOS ${lengan} SPANDEK ${jeniskain} ${warna}`);
  }

  // 2. Jaket/Hoodie — tanpa POLOS, tanpa lengan
  if (
    jeniskain.includes("HOODIE FLEECE") ||
    jeniskain.includes("JAKET FLEECE")
  ) {
    return clean(`KAOSAN ${jeniskain} ${warna}`);
  }

  // 3. Polo — KERAH POLO
  if (jeniskain.includes("POLO")) {
    return clean(`KAOSAN POLOS ${lengan} KERAH POLO ${warna}`);
  }

  // 4. Katun Air — OVERSIZED KATUN AIR
  if (jeniskain.includes("KATUN AIR")) {
    return clean(`KAOSAN POLOS ${lengan} OVERSIZED KATUN AIR ${warna}`);
  }

  // 5. DBF — tampil apa adanya, (OBLONG) hanya jika kode ASLI-nya KO
  if (jeniskain.includes("DBF")) {
    const suffix = kodePrefixAsli === "KO" ? " (OBLONG)" : "";
    return clean(`KAOSAN POLOS ${lengan} ${jeniskain} ${warna}${suffix}`);
  }

  // 6. Jersey generik (selain kasus LL) — jeniskain sebelum warna, tanpa kurung
  if (jeniskain.includes("JERSEY")) {
    return clean(`KAOSAN POLOS ${lengan} ${jeniskain} ${warna}`);
  }

  // 7. Default — kaos polos biasa, jeniskain dalam kurung
  return clean(`KAOSAN POLOS ${lengan} ${warna} (${jeniskain})`);
};

// --- Format Keterangan Produksi otomatis sesuai jenis kaos ---
const formatSpkKeterangan = (item, kode) => {
  const jeniskaos = String(item.brg_jeniskaos || "")
    .trim()
    .toUpperCase();
  const lengan = String(item.brg_lengan || "")
    .trim()
    .toUpperCase();
  const jeniskain = String(item.brg_jeniskain || "")
    .trim()
    .toUpperCase();

  const defaultKet = `Auto-generate dari Rekomendasi SPK — SKU: ${kode}`;

  let hasil = defaultKet;

  if (jeniskain.includes("KATUN AIR")) {
    hasil = `BUATKAN KAOS PENDEK OVERSIZE

Size S (lb=50, pb=69) M (lb=54, pb=70),  L (lb=56 cm, pb=71),  XL (lb=60, pb=72)

MODEL, POLA DAN UKURAN panjang depan belakang sama

Haming 2 jahitan di lengan dan badan bawah

Rib leher lebar. tindes MODEL oversized

Lebar Lengan Mohon dipastikan tidak terlalu besar

Size dan Logo kaosan Jahit jadi satu

Label timbul kaosan di kiri bawah

Dikerjakan di P04 JERON`;
  } else if (jeniskain.includes("JERSEY EMBOZZ")) {
    hasil = `Buatkan JERSEY BAHAN DRYFIT EMBOSS MOTIF TOPO HITAM


Spek dan jahitan standart kaosan, jahitan tindes overdeck

Jahit potongan di bagian belakang punggung, Blazer twiltip kaosan

Size dan Logo kaosan Jahit jadi satu. Packing kaosan

Lengan bagian dalam, ujung obras mohon dikunci

Label timbul kaosan di kiri bawah

Mohon Jahitan rapi dan bagus

DIKERJAKAN DI P4 JERON`;
  } else if (lengan.includes("TUNIK")) {
    hasil = `Buatkan tunik dengan Spek ukuran dan Jahitan standar kaosan

Belahan samping +- 20 CM dan panjang badan 80 CM

Panjang lengan dari atas ke bawah mengecil, leher vneck

Lengan bagian dalam, ujung obras mohon dikunci

Size dan Logo kaosan Jahit jadi satu

Packing kaosan

Mohon jahitan rapi dan bagus, buang benang bersih

DIKERJAKAN DI P04 JERON`;
  } else if (lengan.includes("RIP")) {
    hasil = `Buatkan kaos oblong polos panjang rip

Spek ukuran dan Jahitan standar kaosan

Size dan Logo kaosan Jahit jadi satu

Label timbul kaosan di kiri bawah

Packing kaosan

Mohon jahitan rapi dan bagus, buang benang bersih

DIKERJAKAN DI P4 JERON`;
  } else if (jeniskaos === "KO" && lengan.includes("PENDEK")) {
    hasil = `Buatkan kaos oblong polos pendek

3 Jahitan di lengan dan badan bawah

Spek ukuran dan Jahitan standar kaosan

Lengan bagian dalam, ujung obras mohon dikunci

Size dan Logo kaosan Jahit jadi satu

Label timbul kaosan di kiri bawah

Packing kaosan

Mohon jahitan rapi dan bagus, buang benang bersih

DIKERJAKAN DI P4 JERON`;
  } else if (jeniskaos === "KO" && lengan.includes("PANJANG")) {
    hasil = `Buatkan kaos oblong polos panjang

3 Jahitan di lengan dan badan bawah

Spek ukuran dan Jahitan standar kaosan

Lengan bagian dalam, ujung obras mohon dikunci

Size dan Logo kaosan Jahit jadi satu

Label timbul kaosan di kiri bawah

Packing kaosan

Mohon jahitan rapi dan bagus, buang benang bersih

DIKERJAKAN DI P4 JERON`;
  } else if (jeniskaos === "KK" && lengan.includes("PENDEK")) {
    hasil = `BUATKAN KAOS KERAH

Spek ukuran, pola potong, cara belah samping standar Kaosan. maju bahu. 3 Jahitan

3 kancing kaosan, warna kerah, manset, dan paspol sesuai badan

Size dan Logo kaosan Jahit jadi satu

Label timbul kaosan di kiri bawah

Pakai blazer twiltip kaosan

PACKING KAOSAN. 
Pakai cadangan kancing 1 pcs

DIKERJAKAN DI P4 JERON`;
  } else if (jeniskaos === "KK" && lengan.includes("PANJANG")) {
    hasil = `BUATKAN KAOS KERAH

Spek ukuran, pola potong, cara belah samping standar Kaosan. maju bahu. 3 Jahitan

3 kancing kaosan, warna kerah, rip lengan, dan paspol sesuai badan

Size dan Logo kaosan Jahit jadi satu

Label timbul kaosan di kiri bawah

Pakai blazer twiltip kaosan

PACKING KAOSAN. 
Pakai cadangan kancing 1 pcs

DIKERJAKAN DI P4 JERON`;
  }

  // Konversi LF (\n) jadi CRLF (\r\n) — wajib supaya TMemo Delphi (Windows edit control)
  // mengenali baris baru. \n tunggal tidak dikenali dan bikin teks nempel tanpa spasi.
  return hasil.replace(/\r?\n/g, "\r\n");
};

// --- Ambil daftar Kepentingan (untuk dropdown) ---
const getKepentinganOptions = async () => {
  const [rows] = await pool.query(
    `SELECT DISTINCT kepentingan FROM kencanaprint.tspk_kepentingan ORDER BY kepentingan`,
  );
  return rows.map((r) => r.kepentingan);
};

// --- Hitung rentang dateline berdasarkan Kepentingan + Jo Kode (replikasi logika SO divisi Kaosan) ---
const getDatelineRange = async (kepentingan, joKode) => {
  const [rows] = await pool.query(
    `SELECT * FROM kencanaprint.tspk_kepentingan WHERE kepentingan = ?`,
    [kepentingan],
  );

  let minHari = 0;
  let maxHari = 0;

  if (rows.length > 0) {
    const rules = rows[0];
    const isPengerjaan = ["BR", "SB", "SD", "PL", "DP", "TG", "PM"].some(
      (sub) => String(joKode).toUpperCase().includes(sub),
    );
    if (isPengerjaan) {
      minHari = Number(rules.kaosan1sb) || 0;
      maxHari = Number(rules.kaosan2sb) || 0;
    } else {
      minHari = Number(rules.kaosan1) || 0;
      maxHari = Number(rules.kaosan2) || 0;
    }
  }

  const today = new Date();
  const minDate = new Date(today);
  minDate.setDate(minDate.getDate() + minHari);
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + maxHari);

  return {
    minHari,
    maxHari,
    minDate: format(minDate, "yyyy-MM-dd"),
    maxDate: format(maxDate, "yyyy-MM-dd"),
  };
};

// --- Ambil standar ukuran Kencana (sementara, sebelum standar Kaosan tersedia) ---
const JO_KATEGORI = {
  BB: "ATASAN",
  BU: "ATASAN",
  JK: "ATASAN",
  JS: "ATASAN",
  KK: "ATASAN",
  KO: "ATASAN",
  KS: "ATASAN",
  CL: "BAWAHAN",
  WP: "WEARPACK",
};

const getStandarUkuranKencana = async (joKode, varian = "STANDAR") => {
  const jo = String(joKode || "").toUpperCase();
  const kategori = JO_KATEGORI[jo];
  if (!kategori) return {};

  const kategoriList =
    kategori === "WEARPACK" ? ["ATASAN", "BAWAHAN"] : [kategori];
  const placeholders = kategoriList.map(() => "?").join(",");

  const [standar] = await pool.query(
    `SELECT * FROM tukuran_standar
     WHERE ts_kategori IN (${placeholders}) AND ts_varian = ?`,
    [...kategoriList, varian],
  );

  const standarMap = {};
  for (const row of standar) {
    standarMap[row.ts_ukuran] = row;
  }
  return standarMap;
};

const generateBulkSpk = async (items, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const today = format(new Date(), "yyyy-MM-dd");

    // Kelompokkan per kode barang — satu SO, banyak ukuran
    const grouped = new Map();
    for (const item of items) {
      if (!item.rekomendasi_spk || item.rekomendasi_spk <= 0) continue;
      if (!grouped.has(item.kode)) {
        grouped.set(item.kode, { representative: item, sizes: [] });
      }
      grouped.get(item.kode).sizes.push({
        ukuran: item.ukuran,
        qty: item.rekomendasi_spk,
      });
    }

    let generatedCount = 0;

    for (const [kode, group] of grouped) {
      const { representative, sizes } = group;
      const joKode = determineJoKode(representative, kode);
      const spkNomor = await generateSpkNomorSo(
        connection,
        PERUSH_KODE_DC,
        joKode,
      );
      const spkNama = formatSpkNama(representative, joKode);
      const totalQty = sizes.reduce((sum, s) => sum + s.qty, 0);
      const ukuranGabungan = sizes.map((s) => `${s.ukuran}=${s.qty}`).join(",");

      const kepentingan = representative.kepentingan || "NORMAL";
      const dateline = representative.dateline || today;

      // Tentukan varian ukuran dari brg_lengan (PENDEK/PANJANG)
      const lenganUpper = String(representative.brg_lengan || "").toUpperCase();
      const varianUkuran = lenganUpper.includes("PANJANG")
        ? "LENGAN_PANJANG"
        : "LENGAN_PENDEK";

      // --- VALIDASI (replikasi logika SO divisi 3) ---
      // sumKaosan (total qty per SO) harus sama dengan qtyPesan (spk_jumlah).
      // Karena totalQty dihitung dari items yang sama dengan sizes, ini otomatis sama —
      // dipertahankan sebagai pengaman jika logika berubah di masa depan.
      const sumKaosan = sizes.reduce((acc, s) => acc + Number(s.qty || 0), 0);
      if (sumKaosan === 0) {
        console.warn(`[generateBulkSpk] Qty 0 untuk kode=${kode}, dilewati.`);
        continue;
      }
      if (sumKaosan !== totalQty) {
        throw new Error(
          `Jumlah SO vs Total Qty Order di Detail Barang Kaosan berbeda untuk kode ${kode}.`,
        );
      }

      // 1. Header SO
      await connection.query(
        `INSERT INTO kencanaprint.tspk (
           spk_nomor, spk_is_so, spk_so_ref,
           spk_tanggal, spk_cus_kode, spk_cus_kaosan, spk_sal_kode,
           spk_jo_kode, spk_divisi, spk_nama, spk_jumlah,
           spk_ukuran, spk_kain, spk_finishing, spk_nomor_po,
           spk_dateline, spk_cab, spk_cabkaos, spk_tipe, spk_statuskerja,
           spk_standar_ukuran, spk_varian_ukuran,
           spk_perush_kode, spk_ketbeli, spk_keterangan,
           spk_aktif, spk_close,
           user_create, date_create
         ) VALUES (?, 1, NULL, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Y', 0, ?, NOW())`,
        [
          spkNomor,
          today,
          CUS_KODE_DC,
          SAL_KODE_DC,
          joKode,
          DIVISI_KAOSAN,
          spkNama,
          totalQty,
          ukuranGabungan,
          representative.brg_jeniskain || "",
          "POLOS",
          "STOCK",
          dateline,
          CAB_KODE_DC,
          CAB_KODE_DC,
          "Premium", // [FIX] spk_tipe — sebelumnya literal '' kosong, tidak pernah terisi
          kepentingan,
          "KENCANA", // spk_standar_ukuran
          varianUkuran, // spk_varian_ukuran
          PERUSH_KODE_DC,
          "Rekomendasi otomatis Perencanaan Produksi (DC Planning)",
          formatSpkKeterangan(representative, kode),
          user.kode,
        ],
      );

      // 2. Detail Kaosan (tspk_dc) — WAJIB untuk divisi 3
      // Karena jo_kode di sini selalu barang fisik (KO/KK/LL/JK, bukan jasa BR/SB/SD/PL/DP/TG/PM),
      // kodeItem = kode barang asli (item.kode), bukan nomor SPK
      for (const s of sizes) {
        await connection.query(
          `INSERT INTO kencanaprint.tspk_dc (spkd_nomor, spkd_kode, spkd_ukuran, spkd_qtyorder)
           VALUES (?, ?, ?, ?)`,
          [spkNomor, kode, s.ukuran, s.qty],
        );

        // Sinkronisasi ke tbarangdc_dtl (Ignore if exist) — kode & ukuran sudah pasti ada
        // karena SKU ini memang berasal dari tbarangdc_dtl (data DC Planning)
        await connection.query(
          `INSERT IGNORE INTO tbarangdc_dtl (brgd_kode, brgd_ukuran, brgd_hrg1)
           VALUES (?, ?, 0)`,
          [kode, s.ukuran],
        );
      }

      // 3. Detail Size (tspk_size) — ukuran badan, standar Kencana sementara
      const standarMap = await getStandarUkuranKencana(joKode);
      for (const s of sizes) {
        const d = standarMap[s.ukuran] || {};
        await connection.query(
          `INSERT INTO kencanaprint.tspk_size
            (spks_nomor, spks_size, spks_qty,
             spks_ld, spks_pl_pendek, spks_pl_panjang, spks_p_bahu,
             spks_l_lengan, spks_l_manset, spks_l_pinggang, spks_p_celana,
             spks_l_panggul, spks_l_paha, spks_pesak, spks_l_lutut, spks_l_bawah)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            spkNomor,
            s.ukuran,
            s.qty,
            Number(d.ts_ld) || 0,
            Number(d.ts_pl_pendek) || 0,
            Number(d.ts_pl_panjang) || 0,
            Number(d.ts_p_bahu) || 0,
            Number(d.ts_l_lengan) || 0,
            Number(d.ts_l_manset) || 0,
            Number(d.ts_l_pinggang) || 0,
            Number(d.ts_p_celana) || 0,
            Number(d.ts_l_panggul) || 0,
            Number(d.ts_l_paha) || 0,
            Number(d.ts_pesak) || 0,
            Number(d.ts_l_lutut) || 0,
            Number(d.ts_l_bawah) || 0,
          ],
        );
      }

      // --- Log audit: catat bahwa SO ini hasil auto-generate dari DC Planning ---
      const ukuranDetailLog = sizes
        .map((s) => `${s.ukuran}=${s.qty}`)
        .join(",");
      await connection.query(
        `INSERT INTO kencanaprint.tspk_log_autogenerate
           (log_spk_nomor, log_source, log_kode_barang, log_ukuran_detail, log_qty_total,
            log_gap_dc, log_spk_beredar, log_rekomendasi, log_kepentingan,
            user_create, date_create)
         VALUES (?, 'DC_PLANNING', ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          spkNomor,
          kode,
          ukuranDetailLog,
          totalQty,
          representative.gap_buffer_dc ?? null,
          representative.spk_beredar ?? null,
          representative.rekomendasi_spk ?? null,
          kepentingan,
          user.kode,
        ],
      );

      generatedCount++;
    }

    await connection.commit();
    return {
      message: `Berhasil merilis ${generatedCount} SO baru (mencakup ${items.length} baris SKU/ukuran) ke produksi.`,
    };
  } catch (error) {
    await connection.rollback();
    console.error("Error in generateBulkSpk:", error);
    throw error;
  } finally {
    connection.release();
  }
};

// --- Detail SPK Beredar per kode+ukuran (untuk dialog "klik SPK Beredar") ---
const getSpkBeredarDetail = async (kode, ukuran) => {
  const [rows] = await pool.query(
    `SELECT 
        spk.spk_nomor AS spkNomor,
        spk.spk_tanggal AS tanggal,
        spk.spk_dateline AS dateline,
        spk.spk_statuskerja AS kepentingan,
        spkd.spkd_qtyorder AS qty
     FROM kencanaprint.tspk_dc spkd
     JOIN kencanaprint.tspk spk ON spk.spk_nomor = spkd.spkd_nomor
     WHERE spkd.spkd_kode = ?
       AND spkd.spkd_ukuran = ?
       AND spk.spk_aktif = 'Y'
       AND spk.spk_close = 0
       AND YEAR(spk.spk_tanggal) >= 2026
       -- Belum masuk STBJ sama sekali (persis filter di getPriorityData)
       AND NOT EXISTS (
           SELECT 1 FROM kencanaprint.tstbj_dtl stb
           WHERE stb.stbjd_spk_nomor = spkd.spkd_nomor
             AND stb.stbjd_size = spkd.spkd_ukuran
       )
     ORDER BY spk.spk_tanggal DESC`,
    [kode, ukuran],
  );
  return rows;
};

module.exports = {
  getPriorityData,
  getStoreDetails,
  generateBulkSpk,
  getKepentinganOptions,
  getDatelineRange,
  getSpkBeredarDetail,
};
