const fs = require("fs");
const path = require("path");
const pool = require("../config/database");
const { format } = require("date-fns");

const generateNewProposalNumber = async (cabang, tanggal) => {
  const year = format(new Date(tanggal), "yyyy");
  const prefix = `${cabang}.${year}`;

  const query = `
    SELECT IFNULL(MAX(CAST(RIGHT(ph_nomor, 5) AS UNSIGNED)), 0) AS lastNum
    FROM tpengajuanharga
    WHERE ph_cab = ?
      AND ph_nomor LIKE CONCAT(?, '%')
  `;

  const [rows] = await pool.query(query, [cabang, prefix]);
  const lastNum = parseInt(rows[0].lastNum, 10) || 0;
  const newNum = (lastNum + 1).toString().padStart(5, "0");

  return `${prefix}.${newNum}`;
};

const searchTshirtTypes = async (term, custom) => {
  let query = "SELECT DISTINCT jk_Jenis AS jenisKaos FROM tjeniskaos";
  const params = [];

  if (custom === "Y") {
    query += ' WHERE jk_custom = "Y"';
  } else {
    query += ' WHERE jk_custom = "N"';
  }

  if (term) {
    query += " AND jk_Jenis LIKE ?";
    params.push(`%${term}%`);
  }
  query += " ORDER BY jk_Jenis";
  const [rows] = await pool.query(query, params);
  return rows;
};

const getTshirtTypeDetails = async (jenisKaos, custom) => {
  const sizeQuery = `
        SELECT 
            u.ukuran,
            CASE
                WHEN u.ukuran = "XS" THEN k.jk_xs
                WHEN u.ukuran = "S" THEN k.jk_s WHEN u.ukuran = "M" THEN k.jk_m
                WHEN u.ukuran = "L" THEN k.jk_l WHEN u.ukuran = "XL" THEN k.jk_xl
                WHEN u.ukuran = "2XL" THEN k.jk_2xl WHEN u.ukuran = "3XL" THEN k.jk_3xl
                WHEN u.ukuran = "4XL" THEN k.jk_4xl WHEN u.ukuran = "5XL" THEN k.jk_5xl
                ELSE 0
            END AS hargaPcs
        FROM tukuran u
        JOIN tjeniskaos k ON k.jk_Jenis = ? AND k.jk_custom = ?
        WHERE u.kategori = "" AND u.kode >= 1 AND u.kode <= 16 
        ORDER BY u.kode;
    `;
  const costsQuery = `
        SELECT bt_tambahan, bt_cm, bt_min 
        FROM tbiayatambahan 
        WHERE bt_tambahan IN ('BORDIR', 'DTF')
    `;
  // [BARU] Ambil default kain untuk kombinasi jenisKaos + custom flag ini
  const kainQuery = `
        SELECT jk_default_kain FROM tjeniskaos WHERE jk_Jenis = ? AND jk_custom = ? LIMIT 1
    `;

  try {
    const [[sizeRows], [costRows], [kainRows]] = await Promise.all([
      pool.query(sizeQuery, [jenisKaos, custom]),
      pool.query(costsQuery),
      pool.query(kainQuery, [jenisKaos, custom]), // [BARU]
    ]);

    const costs = {};
    costRows.forEach((row) => {
      if (row.bt_tambahan === "BORDIR") {
        costs.bordir = { cm: row.bt_cm, min: row.bt_min };
      } else if (row.bt_tambahan === "DTF") {
        costs.dtf = { cm: row.bt_cm, min: row.bt_min };
      }
    });

    return {
      sizes: sizeRows,
      costs: costs,
      defaultKain: kainRows[0]?.jk_default_kain || null, // [BARU]
    };
  } catch (error) {
    console.error(
      `[ERROR] Gagal getTshirtTypeDetails untuk jenisKaos: "${jenisKaos}", custom: "${custom}"`,
    );
    console.error(error);
    throw error;
  }
};

const getDiscountByBruto = async (bruto) => {
  if (!bruto || isNaN(parseFloat(bruto))) {
    return 0;
  }

  const query = `
        SELECT diskon 
        FROM tpengajuanharga_diskon 
        WHERE ? >= harga1 AND ? <= harga2
    `;
  const [rows] = await pool.query(query, [bruto, bruto]);

  let diskonRp = 0;
  if (rows.length > 0) {
    const diskonPersen = rows[0].diskon;
    diskonRp = (diskonPersen / 100) * parseFloat(bruto);
  }

  return diskonRp;
};

const searchProductsByType = async (jenisKaos) => {
  const tokens = (jenisKaos || "")
    .split(" ")
    .filter((t) => t.trim().length > 0 && t.toUpperCase() !== "KERAH");

  let query = `
        SELECT 
            a.brg_kode AS Kode,
            TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna)) AS Nama
        FROM tbarangdc a
        WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
    `;

  const params = [];

  if (tokens.length > 0) {
    const firstToken = tokens[0].toUpperCase();

    if (firstToken === "KO") {
      query += ` AND (a.brg_jeniskaos LIKE ? OR a.brg_jeniskaos LIKE ?)`;
      params.push(`%KO%`, `%KK%`);
    } else {
      query += ` AND TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain)) LIKE ?`;
      params.push(`%${tokens[0]}%`);
    }

    for (let i = 1; i < tokens.length; i++) {
      query += ` AND TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain)) LIKE ?`;
      params.push(`%${tokens[i]}%`);
    }
  }

  query += ` ORDER BY Nama`;

  const [rows] = await pool.query(query, params);
  return rows;
};

const searchAdditionalCosts = async () => {
  const query = `
        SELECT 
            bt_tambahan AS tambahan,
            bt_harga AS harga 
        FROM tbiayatambahan 
        ORDER BY bt_tambahan
    `;
  const [rows] = await pool.query(query);
  return rows;
};

const getProposalForEdit = async (nomor) => {
  const headerQuery = `
        SELECT h.*, c.cus_nama 
        FROM tpengajuanharga h 
        LEFT JOIN tcustomer c ON c.cus_kode = h.ph_kd_cus 
        WHERE h.ph_nomor = ?
    `;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0) {
    throw new Error("Data pengajuan tidak ditemukan.");
  }

  const cabang = nomor.substring(0, 3);

  const imagePath = path.join(
    process.cwd(),
    "public",
    "images",
    cabang,
    `${nomor}.jpg`,
  );
  const imageDir = path.join(process.cwd(), "public", "images", cabang);
  let imageUrl = null;

  if (fs.existsSync(imageDir)) {
    const files = fs.readdirSync(imageDir);
    const fileName = files.find((file) => file.startsWith(nomor + "."));

    if (fileName) {
      const timeStamp = Date.now();
      imageUrl = `/images/${cabang}/${fileName}?t=${timeStamp}`;
    }
  }

  const sizeQuery = `
    SELECT 
      s.*,
      TRIM(CONCAT_WS(' ', b.brg_jeniskaos, b.brg_tipe, b.brg_lengan, b.brg_jeniskain, b.brg_warna)) AS nama_barang
    FROM tpengajuanharga_size s 
    LEFT JOIN tbarangdc b ON b.brg_kode = s.phs_kode AND b.brg_aktif = 0 AND b.brg_logstok = 'Y'
    WHERE s.phs_nomor = ?
  `;
  const [sizeRows] = await pool.query(sizeQuery, [nomor]);

  // [BARU] Fallback nama barang dari draft — barang Stok/Custom yang masih
  // berstatus DRAFT belum punya baris di tbarangdc (baru dibuat saat Acc
  // Finance), jadi LEFT JOIN di atas pasti kosong untuk kasus ini. Ambil
  // deskripsi dari tpengajuanharga_barang_draft sebagai gantinya.
  const [allDraftRows] = await pool.query(
    "SELECT pbd_kode_barang_draft, pbd_deskripsi FROM tpengajuanharga_barang_draft WHERE pbd_nomor = ?",
    [nomor],
  );
  const draftDeskripsiMap = new Map(
    allDraftRows.map((r) => [r.pbd_kode_barang_draft, r.pbd_deskripsi]),
  );
  sizeRows.forEach((row) => {
    if (!row.nama_barang) {
      row.nama_barang = draftDeskripsiMap.get(row.phs_kode) || row.nama_barang;
    }
  });

  const bordirQuery = `SELECT * FROM tpengajuanharga_bordir WHERE phb_nomor = ?`;
  const [bordirRows] = await pool.query(bordirQuery, [nomor]);

  const dtfQuery = `SELECT * FROM tpengajuanharga_dtf WHERE phd_nomor = ?`;
  const [dtfRows] = await pool.query(dtfQuery, [nomor]);

  const costQuery = `SELECT * FROM tpengajuanharga_tambahan WHERE pht_nomor = ?`;
  const [costRows] = await pool.query(costQuery, [nomor]);

  const [draftRows] = await pool.query(
    "SELECT * FROM tpengajuanharga_barang_draft WHERE pbd_nomor = ? AND pbd_status = 'DRAFT' ORDER BY pbd_id DESC LIMIT 1",
    [nomor],
  );

  // [BARU] Mode Stok TIDAK PERNAH membuat baris draft (barang langsung
  // di-insert ke tbarangdc saat simpan lewat resolveOrCreateStokBarang) —
  // kalau draft kosong tapi header sudah punya kode barang final, ambil
  // jeniskain/warna langsung dari tbarangdc supaya form edit tetap terisi.
  let barangDraft = draftRows[0] || null;

  if (
    !barangDraft &&
    headerRows[0].ph_custom === "N" &&
    headerRows[0].ph_kode_barang_draft
  ) {
    const [tbarangRows] = await pool.query(
      `SELECT 
        brg_kode AS pbd_kode_barang_draft, 
        brg_jeniskaos AS pbd_jeniskaos, 
        brg_tipe AS pbd_tipe, 
        brg_lengan AS pbd_lengan, 
        brg_jeniskain AS pbd_jeniskain, 
        brg_warna AS pbd_warna,
        TRIM(CONCAT(brg_jeniskaos,' ',brg_tipe,' ',brg_lengan,' ',brg_jeniskain,' ',brg_warna)) AS pbd_deskripsi
      FROM tbarangdc WHERE brg_kode = ? LIMIT 1`,
      [headerRows[0].ph_kode_barang_draft],
    );
    barangDraft = tbarangRows[0] || null;
  }

  // [BARU] Nama katalog terpilih (kalau ada), buat ditampilin balik di form edit
  let sublimKatalogNama = null;
  if (headerRows[0].ph_sublim_katalog_id) {
    const [katalogRows] = await pool.query(
      "SELECT tsk_nama FROM tsublim_katalog WHERE tsk_id = ? LIMIT 1",
      [headerRows[0].ph_sublim_katalog_id],
    );
    sublimKatalogNama = katalogRows[0]?.tsk_nama || null;
  }

  // [BARU] Deteksi bukti Acc Customer
  const accCustomerDir = path.join(
    process.cwd(),
    "public",
    "images",
    cabang,
    "acc-customer",
  );
  let accCustomerProofUrl = null;
  if (fs.existsSync(accCustomerDir)) {
    const accFiles = fs.readdirSync(accCustomerDir);
    const accFileName = accFiles.find((file) => file.startsWith(nomor + "."));
    if (accFileName) {
      accCustomerProofUrl = `/images/${cabang}/acc-customer/${accFileName}?t=${Date.now()}`;
    }
  }

  return {
    header: headerRows[0],
    sizes: sizeRows,
    bordir: bordirRows[0] || {},
    dtf: dtfRows[0] || {},
    additionalCosts: costRows,
    imageUrl: imageUrl,
    barangDraft: barangDraft,
    accCustomerProofUrl,
  };
};

const renameProposalImage = async (tempFilePath, nomor) => {
  return new Promise((resolve, reject) => {
    const fs = require("fs");
    const path = require("path");

    if (!fs.existsSync(tempFilePath)) {
      console.error("Source file does not exist:", tempFilePath);
      return reject(new Error("File sumber tidak ditemukan."));
    }

    const cabang = nomor.substring(0, 3);
    const finalFileName = `${nomor}${path.extname(tempFilePath)}`;

    const branchFolderPath = path.join(
      process.cwd(),
      "public",
      "images",
      cabang,
    );

    try {
      fs.mkdirSync(branchFolderPath, { recursive: true });
    } catch (mkdirError) {
      console.error("Error creating directory:", mkdirError);
      return reject(new Error("Gagal membuat direktori gambar."));
    }

    const finalPath = path.join(branchFolderPath, finalFileName);

    fs.rename(tempFilePath, finalPath, (err) => {
      if (err) {
        console.error("Gagal me-rename file:", err);
        fs.copyFile(tempFilePath, finalPath, (copyErr) => {
          if (copyErr) {
            console.error("Gagal copy file:", copyErr);
            return reject(
              new Error("Gagal memproses file gambar: " + copyErr.message),
            );
          }

          fs.unlink(tempFilePath, (unlinkErr) => {
            if (unlinkErr) {
              console.warn(
                "Warning: Could not delete temp file:",
                tempFilePath,
              );
            }
          });

          resolve(finalPath);
        });
      } else {
        resolve(finalPath);
      }
    });
  });
};

const renameAccCustomerProof = async (tempFilePath, nomor) => {
  return new Promise((resolve, reject) => {
    const fs = require("fs");
    const path = require("path");

    if (!fs.existsSync(tempFilePath)) {
      return reject(new Error("File sumber tidak ditemukan."));
    }

    const cabang = nomor.substring(0, 3);
    const finalFileName = `${nomor}${path.extname(tempFilePath)}`;
    const folderPath = path.join(
      process.cwd(),
      "public",
      "images",
      cabang,
      "acc-customer",
    );

    try {
      fs.mkdirSync(folderPath, { recursive: true });
    } catch (mkdirError) {
      return reject(new Error("Gagal membuat direktori bukti Acc Customer."));
    }

    const finalPath = path.join(folderPath, finalFileName);

    fs.rename(tempFilePath, finalPath, (err) => {
      if (err) {
        fs.copyFile(tempFilePath, finalPath, (copyErr) => {
          if (copyErr)
            return reject(
              new Error("Gagal memproses bukti: " + copyErr.message),
            );
          fs.unlink(tempFilePath, () => {});
          resolve(finalPath);
        });
      } else {
        resolve(finalPath);
      }
    });
  });
};

// ==========================================================================
// [BARU] LOGIC GENERATE KODE BARANG CUSTOM (Draft, dengan histori versioning)
// ==========================================================================

const deriveJenisKaosKode = (additionalCostItems = []) => {
  const hasKrah = additionalCostItems.some((item) =>
    (item.tambahan || "").toUpperCase().includes("KRAH"),
  );
  return hasKrah ? "KK" : "KO";
};

const deriveTipe = ({
  hasBordirData,
  hasDtfData,
  additionalCostItems = [],
}) => {
  if (hasBordirData) return "BORDIR";
  if (hasDtfData) return "DTF";
  const hasSablonManual = additionalCostItems.some((item) =>
    (item.tambahan || "").toUpperCase().includes("SABLON MANUAL"),
  );
  if (hasSablonManual) return "SABLON";
  return "POLOS";
};

const BASE_LENGAN_TRIGGERS = [
  { match: "LENGAN PANJANG 3/4", lengan: "PANJANG 3/4" },
  { match: "LENGAN PANJANG 7/8", lengan: "PANJANG 7/8" },
  { match: "LENGAN PANJANG", lengan: "PANJANG" },
  { match: "RAGLAN PER PCS", lengan: "RAGLAN" },
];

// [BARU] Deteksi lengan langsung dari NAMA JENIS KAOS yang dipilih (bukan
// dari Harga Tambahan). Dicek TERPISAH dan urutannya sengaja dari yang
// PALING SPESIFIK ke PALING UMUM — supaya "PANJANG TUNIK" tidak keburu
// ke-match sebagai "PANJANG" biasa karena keduanya sama-sama mengandung
// substring "PANJANG".
const JENISKAOS_LENGAN_TRIGGERS = [
  { match: "PANJANG TUNIK", lengan: "PANJANG TUNIK" },
  { match: "TUNIK PANJANG", lengan: "PANJANG TUNIK" }, // jaga-jaga urutan kata terbalik di master
  { match: "PANJANG 3/4", lengan: "PANJANG 3/4" },
  { match: "PANJANG 7/8", lengan: "PANJANG 7/8" },
  { match: "PANJANG", lengan: "PANJANG" }, // paling umum, WAJIB dicek PALING TERAKHIR
];

const deriveBaseLenganFromJenisKaos = (jenisKaosNama) => {
  const upper = (jenisKaosNama || "").toUpperCase();
  for (const { match, lengan } of JENISKAOS_LENGAN_TRIGGERS) {
    if (upper.includes(match)) return lengan;
  }
  return null;
};

// Urutan size resmi — dipakai untuk penomoran barcode varian (2 digit, berurutan)
const SIZE_ORDER = [
  "ALLSIZE",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
  "6XL",
  "7XL",
  "8XL",
  "9XL",
  "10XL",
  "OVERSIZED",
  "JUMBO",
];

const sizeOrderIndex = (size) => {
  const idx = SIZE_ORDER.indexOf((size || "").toString().trim().toUpperCase());
  return idx === -1 ? SIZE_ORDER.length : idx; // size tidak dikenal ditaruh paling akhir
};

const LENGAN_SUFFIX_TRIGGERS = [
  { match: "BELAH SAMPING", suffix: "BELAH SAMPING" },
  { match: "MANSET", suffix: "MANSET" },
  { match: "POTONG LENGAN", suffix: "POTONG LENGAN" },
  { match: "RIB LENGAN", suffix: "RIB" },
  { match: "SAKU DEPAN", suffix: "SAKU DEPAN" },
  { match: "SAKU SAMPING", suffix: "SAKU SAMPING" },
  { match: "VARIASI JAHIT BODI BEDA WARNA", suffix: "VARIASI" },
  { match: "VARIASI JAHIT LIST LENGAN BAWAH", suffix: "VARIASI" },
];

const deriveLenganCombo = (additionalCostItems = [], jenisKaosNama = "") => {
  const namesUpper = additionalCostItems.map((item) =>
    (item.tambahan || "").toUpperCase().trim(),
  );

  let baseLengan = "PENDEK";
  let matchedFromAdditional = false;
  for (const { match, lengan } of BASE_LENGAN_TRIGGERS) {
    if (namesUpper.includes(match)) {
      baseLengan = lengan;
      matchedFromAdditional = true;
      break;
    }
  }

  // [BARU] Kalau tidak ada trigger eksplisit dari Harga Tambahan, coba
  // derive dari nama Jenis Kaos yang dipilih. Harga Tambahan tetap MENANG
  // kalau user secara eksplisit pilihnya (misal kasus jenis kaos reguler
  // tapi customer minta lengan panjang custom) — ini cuma fallback untuk
  // kasus jenis kaos yang namanya sudah jelas menyatakan lengannya.
  if (!matchedFromAdditional) {
    const fromJenisKaos = deriveBaseLenganFromJenisKaos(jenisKaosNama);
    if (fromJenisKaos) baseLengan = fromJenisKaos;
  }

  const suffixes = [];
  for (const { match, suffix } of LENGAN_SUFFIX_TRIGGERS) {
    if (namesUpper.includes(match) && !suffixes.includes(suffix)) {
      suffixes.push(suffix);
    }
  }

  return [baseLengan, ...suffixes].join(" ");
};

const resolveLenganFinal = async (
  connection,
  { details = [], additionalCostItems = [], jenisKaosNama = "" },
) => {
  const jenisKaosUpper = (jenisKaosNama || "").toUpperCase();

  const hasOversizedSize = details.some(
    (d) =>
      (d.size || "").toString().trim().toUpperCase() === "OVERSIZED" &&
      Number(d.qty) > 0,
  );

  const hasOversizedName =
    jenisKaosUpper.includes("OVERSIZED") || jenisKaosUpper.includes("OVERSIZE");

  if (hasOversizedSize || hasOversizedName) return "OVERSIZED";

  // [UBAH] Teruskan jenisKaosNama ke deriveLenganCombo
  const combo = deriveLenganCombo(additionalCostItems, jenisKaosNama);
  const [baseLengan, ...suffixParts] = combo.split(" ");

  const isAnak = jenisKaosNama.toUpperCase().includes("ANAK");
  let finalBase = baseLengan;
  if (isAnak) {
    const [rows] = await connection.query(
      "SELECT Lengan FROM tlengan WHERE Lengan = ? LIMIT 1",
      [`${baseLengan} ANAK`],
    );
    if (rows.length > 0) {
      finalBase = rows[0].Lengan;
    }
  }

  return [finalBase, ...suffixParts].join(" ").trim();
};

const resolveJenisKainWarnaKode = async (
  connection,
  jenisKainNama,
  warnaNama,
) => {
  if (!jenisKainNama || !warnaNama) {
    throw new Error(
      "Jenis Kain dan Warna wajib diisi untuk Pengajuan Harga Custom (dipakai untuk generate kode barang).",
    );
  }

  const [kainRows] = await connection.query(
    "SELECT kode FROM tjeniskain WHERE JenisKain = ? LIMIT 1",
    [jenisKainNama],
  );
  if (kainRows.length === 0) {
    throw new Error(`Jenis Kain "${jenisKainNama}" tidak ditemukan di master.`);
  }

  const [warnaRows] = await connection.query(
    "SELECT kode FROM twarna WHERE Warna = ? LIMIT 1",
    [warnaNama],
  );
  if (warnaRows.length === 0) {
    throw new Error(`Warna "${warnaNama}" tidak ditemukan di master.`);
  }

  return { jenisKainKode: kainRows[0].kode, warnaKode: warnaRows[0].kode };
};

const resolveSublimKainWarnaKode = async (connection, kainNama, warnaNama) => {
  if (!kainNama || !warnaNama) {
    throw new Error(
      "Jenis Kain dan Warna Sublim wajib diisi untuk generate kode barang.",
    );
  }

  const [kainRows] = await connection.query(
    "SELECT tk_kode FROM tsublim_kain WHERE tk_nama = ? LIMIT 1",
    [kainNama],
  );
  if (kainRows.length === 0 || !kainRows[0].tk_kode) {
    throw new Error(
      `Kode singkat untuk kain "${kainNama}" belum diisi di master tsublim_kain.`,
    );
  }

  const [warnaRows] = await connection.query(
    "SELECT kode FROM twarna WHERE Warna = ? LIMIT 1",
    [warnaNama],
  );
  if (warnaRows.length === 0) {
    throw new Error(`Warna "${warnaNama}" tidak ditemukan di master.`);
  }

  return { jenisKainKode: kainRows[0].tk_kode, warnaKode: warnaRows[0].kode };
};

const generateNewDraftKode = async (connection, prefix) => {
  const [tbarangdcRows] = await connection.query(
    'SELECT IFNULL(MAX(CAST(RIGHT(brg_kode, 3) AS UNSIGNED)), 0) AS maxNum FROM tbarangdc WHERE brg_ktg = "" AND LEFT(brg_kode, 12) = ? FOR UPDATE',
    [prefix],
  );
  const [draftRows] = await connection.query(
    "SELECT IFNULL(MAX(CAST(RIGHT(pbd_kode_barang_draft, 3) AS UNSIGNED)), 0) AS maxNum FROM tpengajuanharga_barang_draft WHERE LEFT(pbd_kode_barang_draft, 12) = ? FOR UPDATE",
    [prefix],
  );

  const currentMax = Math.max(
    tbarangdcRows[0].maxNum || 0,
    draftRows[0].maxNum || 0,
    99,
  );

  return `${prefix}-${(currentMax + 1).toString().padStart(3, "0")}`;
};

/**
 * [BARU] Untuk mode Stok: generate kode barang dengan derivasi yang SAMA
 * persis kayak Custom (jeniskaos+tipe+lengan+jeniskain+warna), TAPI:
 * - Kalau kombinasi exact sudah ada di tbarangdc, REUSE kode itu (bukan bikin baru)
 * - Insert langsung ke tbarangdc (bukan draft — Stok nggak lewat Acc Finance)
 * - Barcode ukuran baru nyambung ke barcode existing kalau kode-nya sudah
 *   ada variannya (logic sama persis barangDcFormService.save/finalizeCustomBarang)
 */
const resolveOrCreateStokBarang = async (
  connection,
  { jeniskaos, tipe, lengan, jenisKain, warna, sizesWithQty, user },
) => {
  // 1. Cari exact match kombinasi 5 field ini di tbarangdc (barang aktif saja)
  const [existingRows] = await connection.query(
    `SELECT brg_kode FROM tbarangdc
     WHERE brg_jeniskaos = ? AND brg_tipe = ? AND brg_lengan = ? AND brg_jeniskain = ? AND brg_warna = ?
       AND brg_aktif = 0
     LIMIT 1 FOR UPDATE`,
    [jeniskaos, tipe, lengan, jenisKain, warna],
  );

  let kode;
  if (existingRows.length > 0) {
    kode = existingRows[0].brg_kode;
  } else {
    // Kombinasi baru — generate kode & insert langsung (bukan draft)
    const { jenisKainKode, warnaKode } = await resolveJenisKainWarnaKode(
      connection,
      jenisKain,
      warna,
    );
    const prefix = `${jeniskaos}-${jenisKainKode}-${warnaKode}`;
    kode = await generateNewDraftKode(connection, prefix); // reuse counter, walau namanya "draft" cuma generate nomor urut

    const year = new Date().getFullYear().toString();
    const [bcdRows] = await connection.query(
      'SELECT IFNULL(MAX(brg_bcdid), 0) + 1 AS next_id FROM tbarangdc WHERE DATE_FORMAT(date_create, "%Y") = ? FOR UPDATE',
      [year],
    );
    const bcdId = bcdRows[0].next_id;

    await connection.query(
      `INSERT INTO tbarangdc
        (brg_kode, brg_jeniskaos, brg_ktgp, brg_tipe, brg_lengan, brg_jeniskain, brg_warna, brg_aktif, brg_bcdid, brg_logstok, user_create, date_create)
       VALUES (?, ?, 'REGULER', ?, ?, ?, ?, 0, ?, 'Y', ?, NOW())`,
      [kode, jeniskaos, tipe, lengan, jenisKain, warna, bcdId, user.kode],
    );
  }

  // 2. Barcode continuation — pola identik finalizeCustomBarang/barangDcFormService:
  //    kalau kode ini sudah punya varian ukuran, lanjutkan prefix+urutan yang sama;
  //    kalau belum, generate prefix baru dari bcdId.
  const [existingBarcodeRows] = await connection.query(
    `SELECT brgd_barcode FROM tbarangdc_dtl
     WHERE brgd_kode = ? AND brgd_barcode IS NOT NULL AND brgd_barcode <> ''`,
    [kode],
  );

  let barcodePrefix;
  let nextSeq;
  if (existingBarcodeRows.length > 0) {
    const sample = existingBarcodeRows[0].brgd_barcode;
    barcodePrefix =
      sample.length > 2 ? sample.substring(0, sample.length - 2) : sample;
    nextSeq = existingBarcodeRows.reduce((max, row) => {
      const seqPart = parseInt(row.brgd_barcode.slice(-2), 10);
      return isNaN(seqPart) ? max : Math.max(max, seqPart + 1);
    }, 0);
  } else {
    const [brgRow] = await connection.query(
      "SELECT brg_bcdid FROM tbarangdc WHERE brg_kode = ? LIMIT 1",
      [kode],
    );
    const bcdId = brgRow[0]?.brg_bcdid || 0;
    const yearYY = new Date().getFullYear().toString().substring(2);
    barcodePrefix = `${yearYY}${bcdId.toString().padStart(4, "0")}`;
    nextSeq = 0;
  }

  // 3. Insert varian ukuran yang BELUM ADA saja — kalau ukurannya sudah
  // pernah dibuat sebelumnya (kasus "cuma nambah size baru"), skip, jangan
  // dobel/timpa barcode yang sudah ada.
  for (const item of sizesWithQty) {
    const [existingVariant] = await connection.query(
      "SELECT 1 FROM tbarangdc_dtl WHERE brgd_kode = ? AND brgd_ukuran = ? LIMIT 1",
      [kode, item.size],
    );
    if (existingVariant.length > 0) continue;

    const barcode = `${barcodePrefix}${nextSeq.toString().padStart(2, "0")}`;
    nextSeq++;

    await connection.query(
      `INSERT INTO tbarangdc_dtl
        (brgd_kode, brgd_barcode, brgd_ukuran, brgd_hpp, brgd_harga, brgd_min, brgd_max, brgd_mindc, brgd_maxdc)
       VALUES (?, ?, ?, 0, ?, 0, 0, 0, 0)`,
      [kode, barcode, item.size, item.hargaPcs || 0],
    );
  }

  return kode;
};

/**
 * [DIUBAH] Digeneralisasi dari finalizeCustomBarang — sekarang dipakai
 * untuk Custom (ktgp PESANAN) MAUPUN Stok (ktgp REGULER). Stok TIDAK
 * membatasi pencarian exact-match ke kategori tertentu (matchKtgpFilter
 * null) karena barang Stok boleh reuse kode apapun yang kombinasinya
 * identik, sedangkan Custom tetap dibatasi ke 'PESANAN' saja (perilaku lama
 * dipertahankan, supaya tidak salah reuse kode barang reguler).
 */
const finalizeBarangDraft = async (
  connection,
  phNomor,
  user,
  { matchKtgpFilter, newKtgp },
) => {
  const [draftRows] = await connection.query(
    "SELECT * FROM tpengajuanharga_barang_draft WHERE pbd_nomor = ? AND pbd_kategori = 'UTAMA' AND pbd_status = 'DRAFT' ORDER BY pbd_id DESC LIMIT 1 FOR UPDATE",
    [phNomor],
  );
  if (draftRows.length === 0) return null;
  const draft = draftRows[0];

  let matchQuery = `SELECT brg_kode FROM tbarangdc
     WHERE brg_jeniskaos = ? AND brg_tipe = ? AND brg_lengan = ? AND brg_jeniskain = ? AND brg_warna = ?
       AND brg_aktif = 0`;
  const matchParams = [
    draft.pbd_jeniskaos,
    draft.pbd_tipe,
    draft.pbd_lengan,
    draft.pbd_jeniskain,
    draft.pbd_warna,
  ];
  if (matchKtgpFilter) {
    matchQuery += ` AND brg_ktgp = ?`;
    matchParams.push(matchKtgpFilter);
  }
  matchQuery += ` LIMIT 1 FOR UPDATE`;

  const [existingRows] = await connection.query(matchQuery, matchParams);

  let finalKode;
  if (existingRows.length > 0) {
    finalKode = existingRows[0].brg_kode;
  } else {
    finalKode = draft.pbd_kode_barang_draft;
    const year = new Date().getFullYear().toString();
    const [bcdRows] = await connection.query(
      'SELECT IFNULL(MAX(brg_bcdid), 0) + 1 AS next_id FROM tbarangdc WHERE DATE_FORMAT(date_create, "%Y") = ? FOR UPDATE',
      [year],
    );
    const bcdId = bcdRows[0].next_id;

    await connection.query(
      `INSERT INTO tbarangdc
        (brg_kode, brg_jeniskaos, brg_ktgp, brg_tipe, brg_lengan, brg_jeniskain, brg_warna, brg_aktif, brg_bcdid, brg_logstok, user_create, date_create)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'Y', ?, NOW())`,
      [
        finalKode,
        draft.pbd_jeniskaos,
        newKtgp,
        draft.pbd_tipe,
        draft.pbd_lengan,
        draft.pbd_jeniskain,
        draft.pbd_warna,
        bcdId,
        user.kode,
      ],
    );
  }

  const [sizeRowsRaw] = await connection.query(
    "SELECT DISTINCT phs_size FROM tpengajuanharga_size WHERE phs_nomor = ?",
    [phNomor],
  );
  const sortedSizes = sizeRowsRaw
    .map((r) => r.phs_size)
    .sort((a, b) => sizeOrderIndex(a) - sizeOrderIndex(b));

  const [existingBarcodeRows] = await connection.query(
    `SELECT brgd_barcode FROM tbarangdc_dtl WHERE brgd_kode = ? AND brgd_barcode IS NOT NULL AND brgd_barcode <> ''`,
    [finalKode],
  );
  let barcodePrefix, nextSeq;
  if (existingBarcodeRows.length > 0) {
    const sample = existingBarcodeRows[0].brgd_barcode;
    barcodePrefix =
      sample.length > 2 ? sample.substring(0, sample.length - 2) : sample;
    nextSeq = existingBarcodeRows.reduce((max, row) => {
      const seqPart = parseInt(row.brgd_barcode.slice(-2), 10);
      return isNaN(seqPart) ? max : Math.max(max, seqPart + 1);
    }, 0);
  } else {
    const [brgRow] = await connection.query(
      "SELECT brg_bcdid FROM tbarangdc WHERE brg_kode = ? LIMIT 1",
      [finalKode],
    );
    const bcdId = brgRow[0]?.brg_bcdid || 0;
    const yearYY = new Date().getFullYear().toString().substring(2);
    barcodePrefix = `${yearYY}${bcdId.toString().padStart(4, "0")}`;
    nextSeq = 0;
  }

  for (const size of sortedSizes) {
    const [existingVariant] = await connection.query(
      "SELECT 1 FROM tbarangdc_dtl WHERE brgd_kode = ? AND brgd_ukuran = ? LIMIT 1",
      [finalKode, size],
    );
    if (existingVariant.length > 0) continue;
    const barcode = `${barcodePrefix}${nextSeq.toString().padStart(2, "0")}`;
    nextSeq++;
    await connection.query(
      `INSERT INTO tbarangdc_dtl
        (brgd_kode, brgd_barcode, brgd_ukuran, brgd_hpp, brgd_harga, brgd_min, brgd_max, brgd_mindc, brgd_maxdc, brgd_ph_nomor)
       VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, ?)`,
      [finalKode, barcode, size, phNomor],
    );
  }

  await connection.query(
    "UPDATE tpengajuanharga_barang_draft SET pbd_status = 'FINAL', pbd_finalized_kode = ? WHERE pbd_id = ?",
    [finalKode, draft.pbd_id],
  );
  if (finalKode !== draft.pbd_kode_barang_draft) {
    await connection.query(
      "UPDATE tpengajuanharga_size SET phs_kode = ? WHERE phs_nomor = ? AND phs_kode = ?",
      [finalKode, phNomor, draft.pbd_kode_barang_draft],
    );
  }
  await connection.query(
    "UPDATE tpengajuanharga SET ph_kode_barang_draft = ? WHERE ph_nomor = ?",
    [finalKode, phNomor],
  );

  return finalKode;
};

const finalizeCustomBarang = (connection, phNomor, user) =>
  finalizeBarangDraft(connection, phNomor, user, {
    matchKtgpFilter: "PESANAN",
    newKtgp: "PESANAN",
  });

// [BARU]
const finalizeStokBarang = (connection, phNomor, user) =>
  finalizeBarangDraft(connection, phNomor, user, {
    matchKtgpFilter: null, // boleh reuse kode barang apapun yang kombinasinya identik
    newKtgp: "REGULER",
  });

/**
 * Acc Finance: transisi ACC_CUSTOMER -> ACC_FINANCE, sekalian finalisasi kode
 * barang (kalau custom) dalam 1 transaction yang sama.
 */
const approveFinance = async (phNomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [statusRows] = await connection.query(
      "SELECT ph_status, ph_custom, ph_sublim_kain FROM tpengajuanharga WHERE ph_nomor = ? FOR UPDATE", // [FIX] tambah ph_sublim_kain
      [phNomor],
    );
    if (statusRows.length === 0)
      throw new Error("Pengajuan harga tidak ditemukan.");

    const currentStatus = statusRows[0].ph_status;
    if (currentStatus !== "ACC_CUSTOMER") {
      throw new Error(
        `Transisi tidak diperbolehkan: status saat ini "${currentStatus}", harus "ACC_CUSTOMER" untuk Acc Finance.`,
      );
    }

    let finalKode = null;
    if (statusRows[0].ph_custom === "Y") {
      finalKode = await finalizeCustomBarang(connection, phNomor, user);
    } else if (
      statusRows[0].ph_custom === "N" &&
      !statusRows[0].ph_sublim_kain
    ) {
      // [BARU] Mode Stok — sebelumnya langsung insert saat draft, sekarang baru
      // difinalisasi di titik yang sama kayak Custom.
      finalKode = await finalizeStokBarang(connection, phNomor, user);
    }

    await connection.query(
      "UPDATE tpengajuanharga SET ph_status = 'ACC_FINANCE', ph_status_updated = NOW(), ph_apv = ? WHERE ph_nomor = ?",
      [user.kode, phNomor],
    );

    await connection.query(
      `INSERT INTO tpengajuanharga_status_log
        (phl_nomor, phl_status_from, phl_status_to, phl_user, phl_source_system, phl_keterangan)
       VALUES (?, 'ACC_CUSTOMER', 'ACC_FINANCE', ?, 'KAOSAN', ?)`,
      [
        phNomor,
        user.kode,
        finalKode ? `Kode barang final: ${finalKode}` : "Acc Finance",
      ],
    );

    await connection.commit();
    return {
      nomor: phNomor,
      statusFrom: "ACC_CUSTOMER",
      statusTo: "ACC_FINANCE",
      finalKode,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// ==========================================================================
// [BARU] LOGIC SUBLIM/JERSEY
// ==========================================================================

const getSublimKainOptions = async () => {
  const [rows] = await pool.query(
    "SELECT tk_nama AS nama, tk_gambar AS gambar, tk_keterangan AS keterangan FROM tsublim_kain WHERE tk_aktif = 1 ORDER BY tk_id",
  );
  return rows;
};

const getSublimJenisJerseyOptions = async (kain) => {
  const [rows] = await pool.query(
    `SELECT DISTINCT h.tsh_jeniskaos, h.tsh_lengan,
        (SELECT tsk_gambar FROM tsublim_katalog k
         WHERE k.tsk_jeniskaos = h.tsh_jeniskaos AND k.tsk_lengan = h.tsh_lengan AND k.tsk_aktif = 1
         ORDER BY tsk_id LIMIT 1) AS thumbnail
     FROM tsublim_harga h
     WHERE h.tsh_tipe = 'JERSEY' AND h.tsh_kain = ? AND h.tsh_lengan NOT LIKE 'PANJANG%'
     ORDER BY h.tsh_id`,
    [kain],
  );
  return rows.map((r) => ({
    jeniskaos: r.tsh_jeniskaos,
    lengan: r.tsh_lengan,
    label: `${r.tsh_jeniskaos === "KK" ? "Krah" : "Oblong"} ${r.tsh_lengan}`,
    thumbnail: r.thumbnail,
  }));
};

/**
 * [BARU] Semua entri katalog (bisa banyak foto) untuk 1 kategori tertentu —
 * dipakai saat user klik "lihat semua desain" di kategori yang sudah dipilih.
 */
const getSublimKatalogByKategori = async (jeniskaos, lengan) => {
  const [rows] = await pool.query(
    `SELECT tsk_id AS id, tsk_nama AS nama, tsk_gambar AS gambar, tsk_keterangan AS keterangan
     FROM tsublim_katalog
     WHERE tsk_jeniskaos = ? AND tsk_lengan = ? AND tsk_aktif = 1
     ORDER BY tsk_id`,
    [jeniskaos, lengan],
  );
  return rows;
};

const getSublimKatalog = async () => {
  const [rows] = await pool.query(
    "SELECT tsk_id AS id, tsk_nama AS nama, tsk_gambar AS gambar, tsk_keterangan AS keterangan FROM tsublim_katalog WHERE tsk_aktif = 1 ORDER BY tsk_nama",
  );
  return rows;
};

/**
 * Cari harga tier yang cocok untuk qty tertentu. tsh_qty_max NULL berarti
 * tanpa batas atas (tier ">500").
 */
const lookupSublimHarga = async (
  connection,
  { tipe, kain, jeniskaos, lengan, qty },
) => {
  const [rows] = await connection.query(
    `SELECT tsh_harga FROM tsublim_harga
     WHERE tsh_tipe = ? AND tsh_kain <=> ? AND tsh_jeniskaos <=> ? AND tsh_lengan <=> ?
       AND ? >= tsh_qty_min AND (tsh_qty_max IS NULL OR ? <= tsh_qty_max)
     LIMIT 1`,
    [tipe, kain || null, jeniskaos || null, lengan || null, qty, qty],
  );
  return rows[0]?.tsh_harga ? Number(rows[0].tsh_harga) : null;
};

/**
 * Resolusi harga Jersey akhir untuk 1 qty tertentu: base PENDEK, atau kalau
 * lenganPanjang dipilih -> coba cari row PANJANG eksplisit dulu (kalau nanti
 * ditambahkan ke master), fallback ke base PENDEK + surcharge flat Rp7500.
 */
const resolveSublimJerseyHarga = async (
  connection,
  { kain, jeniskaos, baseLengan, lenganPanjang, qty },
) => {
  if (!lenganPanjang) {
    const harga = await lookupSublimHarga(connection, {
      tipe: "JERSEY",
      kain,
      jeniskaos,
      lengan: baseLengan,
      qty,
    });
    return { lenganFinal: baseLengan, harga };
  }

  const lenganPanjangName = baseLengan.replace(/^PENDEK/, "PANJANG");
  const hargaPanjangEksplisit = await lookupSublimHarga(connection, {
    tipe: "JERSEY",
    kain,
    jeniskaos,
    lengan: lenganPanjangName,
    qty,
  });
  if (hargaPanjangEksplisit !== null) {
    return { lenganFinal: lenganPanjangName, harga: hargaPanjangEksplisit };
  }

  const hargaBase = await lookupSublimHarga(connection, {
    tipe: "JERSEY",
    kain,
    jeniskaos,
    lengan: baseLengan,
    qty,
  });
  const surcharge = await lookupSublimHarga(connection, {
    tipe: "SURCHARGE",
    kain: null,
    jeniskaos: null,
    lengan: "LENGAN_PANJANG",
    qty,
  });
  return {
    lenganFinal: lenganPanjangName,
    harga: hargaBase !== null ? hargaBase + (surcharge || 0) : null,
  };
};

const resolveSublimCelanaHarga = async (connection, { kain, qty }) => {
  return lookupSublimHarga(connection, {
    tipe: "CELANA",
    kain,
    jeniskaos: null,
    lengan: null,
    qty,
  });
};

/**
 * Generate/reuse kode draft utk kategori tertentu (UTAMA/CELANA), dengan
 * versioning independen per kategori — mirror generateOrReuseDraftKodeBarang
 * lama, tapi sekarang di-scope per (ph_nomor, kategori).
 */
const generateOrReuseSublimDraft = async (
  connection,
  { nomor, kategori, isNew, jeniskaos, tipe, lengan, jenisKain, warna, user },
) => {
  const { jenisKainKode, warnaKode } = await resolveSublimKainWarnaKode(
    connection,
    jenisKain,
    warna,
  );
  const prefix = `${jeniskaos}-${jenisKainKode}-${warnaKode}`;
  const deskripsi = [jeniskaos, tipe, lengan, jenisKain, warna]
    .filter(Boolean)
    .join(" ");

  let activeDraftRow = null;
  if (!isNew) {
    const [activeRows] = await connection.query(
      "SELECT * FROM tpengajuanharga_barang_draft WHERE pbd_nomor = ? AND pbd_kategori = ? AND pbd_status = 'DRAFT' ORDER BY pbd_id DESC LIMIT 1 FOR UPDATE",
      [nomor, kategori],
    );
    activeDraftRow = activeRows[0] || null;
  }

  const comboUnchanged =
    activeDraftRow &&
    activeDraftRow.pbd_jeniskaos === jeniskaos &&
    activeDraftRow.pbd_tipe === tipe &&
    activeDraftRow.pbd_lengan === lengan &&
    activeDraftRow.pbd_jeniskain === jenisKain &&
    activeDraftRow.pbd_warna === warna;

  if (comboUnchanged) {
    return {
      kode: activeDraftRow.pbd_kode_barang_draft,
      deskripsi: activeDraftRow.pbd_deskripsi,
    };
  }

  const kode = await generateNewDraftKode(connection, prefix);

  if (activeDraftRow) {
    await connection.query(
      "UPDATE tpengajuanharga_barang_draft SET pbd_status = 'SUPERSEDED' WHERE pbd_id = ?",
      [activeDraftRow.pbd_id],
    );
  }

  await connection.query(
    `INSERT INTO tpengajuanharga_barang_draft
      (pbd_nomor, pbd_kategori, pbd_kode_barang_draft, pbd_jeniskaos, pbd_tipe, pbd_lengan, pbd_jeniskain, pbd_warna, pbd_deskripsi, pbd_status, user_create)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)`,
    [
      nomor,
      kategori,
      kode,
      jeniskaos,
      tipe,
      lengan,
      jenisKain,
      warna,
      deskripsi,
      user.kode,
    ],
  );

  return { kode, deskripsi };
};

const previewSublimHarga = async (payload) => {
  const { kain, jeniskaos, baseLengan, lenganPanjang, jerseyQty, celanaQty } =
    payload;

  const result = {
    jerseyHargaPerPcs: null,
    celanaHargaPerPcs: null,
    lenganFinal: baseLengan,
  };

  if (jerseyQty > 0) {
    const jersey = await resolveSublimJerseyHarga(pool, {
      kain,
      jeniskaos,
      baseLengan,
      lenganPanjang,
      qty: jerseyQty,
    });
    result.jerseyHargaPerPcs = jersey.harga;
    result.lenganFinal = jersey.lenganFinal;
  }
  if (celanaQty > 0) {
    result.celanaHargaPerPcs = await resolveSublimCelanaHarga(pool, {
      kain,
      qty: celanaQty,
    });
  }
  return result;
};

const saveProposal = async (data) => {
  const {
    header,
    details,
    bordirItems = [],
    dtfItems = [],
    additionalCostItems = [],
    user,
    isNew,
    biayaPerCmBordir,
    bordirMinCharge,
    bordirCost,
    biayaPerCmDtf,
    dtfMinCharge,
    dtfCost,
    footer,
  } = data;
  const connection = await pool.getConnection();

  const hasBordirData = bordirItems.some(
    (item) => (item.p || 0) > 0 || (item.l || 0) > 0,
  );
  const hasDtfData = dtfItems.some(
    (item) => (item.p || 0) > 0 || (item.l || 0) > 0,
  );

  try {
    await connection.beginTransaction();

    let nomor = header.nomor;
    // [BARU] State kunci harga — orthogonal dari ph_status, cuma relevan
    // di mode edit (proposal baru selalu mulai unlocked)
    let isCurrentlyLocked = false;
    let existingLockedBy = null;
    let existingLockedAt = null;

    if (isNew) {
      nomor = await generateNewProposalNumber(user.cabang, header.tanggal);
    } else {
      const [statusRows] = await connection.query(
        "SELECT ph_status, ph_harga_locked, ph_harga_locked_by, ph_harga_locked_at FROM tpengajuanharga WHERE ph_nomor = ? FOR UPDATE",
        [nomor],
      );
      if (statusRows.length === 0) {
        throw new Error("Pengajuan harga tidak ditemukan.");
      }
      const currentStatus = statusRows[0].ph_status || "DRAFT";
      if (currentStatus === "ACC_CUSTOMER") {
        if (!user.canApprovePrice) {
          throw new Error(
            "Pengajuan harga berstatus ACC_CUSTOMER hanya bisa diubah oleh user dengan hak approval Finance.",
          );
        }
      } else if (currentStatus !== "DRAFT") {
        throw new Error(
          `Pengajuan harga dengan status "${currentStatus}" tidak bisa diubah lewat form ini.`,
        );
      }
      isCurrentlyLocked = statusRows[0].ph_harga_locked === "Y";
      existingLockedBy = statusRows[0].ph_harga_locked_by;
      existingLockedAt = statusRows[0].ph_harga_locked_at;
    }

    const isCustom = header.ketersediaan === "Custom";
    const isStokMode = header.ketersediaan === "Stok";
    let kodeBarangDraft = null;
    let kodeBarangDeskripsi = null;

    if (isCustom || isStokMode) {
      if (isStokMode) {
        if (!header.jenisKain)
          throw new Error("Jenis Kain harus diisi untuk Pengajuan Stok.");
        if (!header.warna)
          throw new Error("Warna harus diisi untuk Pengajuan Stok.");
      }

      const genJenisKaos = deriveJenisKaosKode(additionalCostItems);
      const genTipe = deriveTipe({
        hasBordirData,
        hasDtfData,
        additionalCostItems,
      });
      const genLengan = await resolveLenganFinal(connection, {
        details,
        additionalCostItems,
        jenisKaosNama: header.jenisKaos || "",
      });
      const genJenisKain = header.jenisKain || "";
      const genWarna = header.warna || "";

      const { jenisKainKode, warnaKode } = await resolveJenisKainWarnaKode(
        connection,
        genJenisKain,
        genWarna,
      );
      const prefix = `${genJenisKaos}-${jenisKainKode}-${warnaKode}`;
      const deskripsi = [
        genJenisKaos,
        genTipe,
        genLengan,
        genJenisKain,
        genWarna,
      ]
        .filter(Boolean)
        .join(" ");

      let activeDraftRow = null;
      if (!isNew) {
        const [activeRows] = await connection.query(
          "SELECT * FROM tpengajuanharga_barang_draft WHERE pbd_nomor = ? AND pbd_status = 'DRAFT' ORDER BY pbd_id DESC LIMIT 1 FOR UPDATE",
          [nomor],
        );
        activeDraftRow = activeRows[0] || null;
      }

      const comboUnchanged =
        activeDraftRow &&
        activeDraftRow.pbd_jeniskaos === genJenisKaos &&
        activeDraftRow.pbd_tipe === genTipe &&
        activeDraftRow.pbd_lengan === genLengan &&
        activeDraftRow.pbd_jeniskain === genJenisKain &&
        activeDraftRow.pbd_warna === genWarna;

      if (comboUnchanged) {
        kodeBarangDraft = activeDraftRow.pbd_kode_barang_draft;
        kodeBarangDeskripsi = activeDraftRow.pbd_deskripsi;
      } else {
        kodeBarangDraft = await generateNewDraftKode(connection, prefix);
        kodeBarangDeskripsi = deskripsi;

        // [FIX] Tandai draft LAMA sebagai basi — ini yang sebelumnya HILANG di
        // mode Stok, penyebab tbarangdc kebanjiran barang orphan tiap kali
        // kombinasi (jeniskaos/tipe/lengan/jeniskain/warna) diubah saat masih draft.
        if (activeDraftRow) {
          await connection.query(
            "UPDATE tpengajuanharga_barang_draft SET pbd_status = 'SUPERSEDED' WHERE pbd_id = ?",
            [activeDraftRow.pbd_id],
          );
        }

        await connection.query(
          `INSERT INTO tpengajuanharga_barang_draft
            (pbd_nomor, pbd_kode_barang_draft, pbd_jeniskaos, pbd_tipe, pbd_lengan, pbd_jeniskain, pbd_warna, pbd_deskripsi, pbd_status, user_create)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)`,
          [
            nomor,
            kodeBarangDraft,
            genJenisKaos,
            genTipe,
            genLengan,
            genJenisKain,
            genWarna,
            deskripsi,
            user.kode,
          ],
        );
      }
    }

    const isSublim = header.ketersediaan === "Sublim";
    let kodeBarangJersey = null,
      kodeBarangCelana = null;
    let jerseyDeskripsi = null,
      celanaDeskripsi = null;
    let jerseyHargaPerPcs = 0,
      celanaHargaPerPcs = 0;
    let lenganFinal = null;
    let katalogGambar = null;

    if (isSublim) {
      const sublim = data.sublim || {};
      // [FIX] katalogGambar dipindah ke sini — sebelumnya dipanggil sebelum
      // `sublim` didefinisikan, bikin "sublim is not defined".
      katalogGambar = sublim.katalogGambar || null;

      const {
        kain,
        warna,
        jeniskaos,
        baseLengan,
        lenganPanjang,
        katalogId,
        jerseySizes = [],
        celanaSizes = [],
      } = sublim;

      if (!kain || !warna || !jeniskaos || !baseLengan) {
        throw new Error(
          "Kain, Warna, Jenis Kaos, dan Jenis Jersey wajib diisi untuk Pengajuan Sublim.",
        );
      }

      const totalJerseyQty = jerseySizes.reduce(
        (s, r) => s + (Number(r.qty) || 0),
        0,
      );
      const totalCelanaQty = celanaSizes.reduce(
        (s, r) => s + (Number(r.qty) || 0),
        0,
      );

      if (totalJerseyQty > 0) {
        const jersey = await resolveSublimJerseyHarga(connection, {
          kain,
          jeniskaos,
          baseLengan,
          lenganPanjang,
          qty: totalJerseyQty,
        });
        if (jersey.harga === null)
          throw new Error("Tier harga Jersey untuk qty ini tidak ditemukan.");
        jerseyHargaPerPcs = jersey.harga;
        lenganFinal = jersey.lenganFinal;

        const draft = await generateOrReuseSublimDraft(connection, {
          nomor,
          kategori: "UTAMA",
          isNew,
          jeniskaos,
          tipe: "SUBLIM",
          lengan: lenganFinal,
          jenisKain: kain,
          warna,
          user,
        });
        kodeBarangJersey = draft.kode;
        jerseyDeskripsi = draft.deskripsi;
      }

      if (totalCelanaQty > 0) {
        celanaHargaPerPcs = await resolveSublimCelanaHarga(connection, {
          kain,
          qty: totalCelanaQty,
        });
        if (celanaHargaPerPcs === null)
          throw new Error("Harga Celana untuk kain ini tidak ditemukan.");

        const draft = await generateOrReuseSublimDraft(connection, {
          nomor,
          kategori: "CELANA",
          isNew,
          jeniskaos: "CL",
          tipe: "SUBLIM",
          lengan: "CELANA",
          jenisKain: kain,
          warna,
          user,
        });
        kodeBarangCelana = draft.kode;
        celanaDeskripsi = draft.deskripsi;
      }
    }

    if (isNew) {
      const headerQuery = `
        INSERT INTO tpengajuanharga 
          (ph_nomor, ph_tanggal, ph_custom, ph_kd_cus, ph_ket, ph_jenis, ph_apv, ph_status, ph_status_updated, ph_diskon, ph_cab,
          ph_kode_barang_draft, ph_sublim_kain, ph_sublim_katalog_id, ph_sublim_katalog_gambar, ph_celana_kode_barang_draft, 
          user_create, date_create) 
        VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', NOW(), ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;
      await connection.query(headerQuery, [
        nomor,
        header.tanggal,
        isCustom ? "Y" : "N",
        header.customerKode,
        header.keterangan,
        header.jenisKaos,
        header.approval || "",
        footer?.diskon || 0,
        user.cabang,
        isSublim ? kodeBarangJersey : kodeBarangDraft,
        isSublim ? data.sublim.kain : null,
        isSublim ? data.sublim.katalogId || null : null,
        isSublim ? katalogGambar : null,
        isSublim ? kodeBarangCelana : null,
        user.kode,
      ]);

      await connection.query(
        `INSERT INTO tpengajuanharga_status_log
          (phl_nomor, phl_status_from, phl_status_to, phl_user, phl_source_system, phl_keterangan)
         VALUES (?, NULL, 'DRAFT', ?, 'KAOSAN', 'Pengajuan harga dibuat')`,
        [nomor, user.kode],
      );
    } else {
      const headerQuery = `
        UPDATE tpengajuanharga SET 
          ph_tanggal = ?, ph_custom = ?, ph_kd_cus = ?, ph_ket = ?, ph_jenis = ?, ph_apv = ?, ph_diskon = ?, ph_kode_barang_draft = ?, 
          ph_harga_locked = ?, ph_harga_locked_by = ?, ph_harga_locked_at = ?,
          user_modified = ?, date_modified = NOW() 
        WHERE ph_nomor = ?
      `;
      await connection.query(headerQuery, [
        header.tanggal,
        isCustom ? "Y" : "N",
        header.customerKode,
        header.keterangan,
        header.jenisKaos,
        header.approval || "",
        footer?.diskon || 0,
        kodeBarangDraft,
        finalHargaLocked,
        finalLockedBy,
        finalLockedAt,
        user.kode,
        nomor,
      ]);
    }

    // ========================================================================
    // [BARU] LOGIKA KUNCI HARGA FINANCE
    // Orthogonal dari ph_status — hanya mengunci FIELD HARGA, bukan seluruh
    // form. SC tetap bebas ubah qty/biaya tambahan/dll selama proses normal.
    // ========================================================================
    let finalHargaLocked = isCurrentlyLocked ? "Y" : "N";
    let finalLockedBy = existingLockedBy;
    let finalLockedAt = existingLockedAt;

    if (!isNew && !isSublim && details && details.length > 0) {
      const [oldPriceRows] = await connection.query(
        "SELECT phs_size, phs_harga FROM tpengajuanharga_size WHERE phs_nomor = ?",
        [nomor],
      );
      const oldPriceMap = new Map(
        oldPriceRows.map((r) => [r.phs_size, Number(r.phs_harga)]),
      );

      if (!isCurrentlyLocked && user.kode === "DARUL") {
        // Cek apakah DARUL benar-benar mengubah salah satu harga (bukan
        // cuma menyimpan ulang tanpa perubahan)
        const hasPriceChange = details.some((item) => {
          if (!oldPriceMap.has(item.size)) return false; // baris baru, bukan "perubahan"
          return Number(item.hargaPcs || 0) !== oldPriceMap.get(item.size);
        });
        if (hasPriceChange) {
          finalHargaLocked = "Y";
          finalLockedBy = "DARUL";
          finalLockedAt = new Date();
        }
      } else if (isCurrentlyLocked && user.kode !== "DARUL") {
        // [SAFETY NET] Kalau sudah terkunci dan yang simpan BUKAN DARUL,
        // paksa kembalikan ke harga lama meskipun payload yang terkirim
        // beda (jaga-jaga kalau frontend readonly-nya ke-bypass). SC tetap
        // bisa mengubah qty/data lain di baris yang sama, cuma harganya
        // yang dipaksa balik.
        details.forEach((item) => {
          if (oldPriceMap.has(item.size)) {
            item.hargaPcs = oldPriceMap.get(item.size);
          }
        });
      }
    }

    await connection.query(
      `DELETE FROM tpengajuanharga_size WHERE phs_nomor = ?`,
      [nomor],
    );

    if (isSublim) {
      const sizeQuery = `INSERT INTO tpengajuanharga_size (phs_nomor, phs_kategori, phs_kode, phs_size, phs_jumlah, phs_harga) VALUES (?, ?, ?, ?, ?, ?)`;
      for (const item of data.sublim.jerseySizes || []) {
        if (item.qty > 0) {
          await connection.query(sizeQuery, [
            nomor,
            "UTAMA",
            kodeBarangJersey,
            item.size,
            item.qty,
            jerseyHargaPerPcs,
          ]);
        }
      }
      for (const item of data.sublim.celanaSizes || []) {
        if (item.qty > 0) {
          await connection.query(sizeQuery, [
            nomor,
            "CELANA",
            kodeBarangCelana,
            item.size,
            item.qty,
            celanaHargaPerPcs,
          ]);
        }
      }
    } else if (details && details.length > 0) {
      const sizeQuery = `
        INSERT INTO tpengajuanharga_size (phs_nomor, phs_kode, phs_size, phs_jumlah, phs_harga)
        VALUES (?, ?, ?, ?, ?)
      `;
      for (const item of details) {
        if (item.qty > 0) {
          // [FIX] Stok sekarang juga pakai kode auto-generate, bukan input manual per baris
          const finalKode =
            isCustom || isStokMode ? kodeBarangDraft : item.kodeBarang || "";
          await connection.query(sizeQuery, [
            nomor,
            finalKode,
            item.size,
            item.qty,
            item.hargaPcs || 0,
          ]);
        }
      }
    }

    await connection.query(
      `DELETE FROM tpengajuanharga_tambahan WHERE pht_nomor = ?`,
      [nomor],
    );

    if (additionalCostItems && additionalCostItems.length > 0) {
      const costQuery = `
        INSERT INTO tpengajuanharga_tambahan (pht_nomor, pht_jenis, pht_harga)
        VALUES (?, ?, ?)
      `;
      for (const item of additionalCostItems) {
        if (item.tambahan && item.harga > 0) {
          await connection.query(costQuery, [nomor, item.tambahan, item.harga]);
        }
      }
    }

    await connection.query(
      `DELETE FROM tpengajuanharga_bordir WHERE phb_nomor = ?`,
      [nomor],
    );
    if (hasBordirData || biayaPerCmBordir > 0 || bordirCost > 0) {
      const bordirQuery = `
        INSERT INTO tpengajuanharga_bordir (phb_nomor, phb_cmbordir, phb_minbordir, phb_rpbordir, phb_bordirp1, phb_bordirl1, phb_bordirp2, phb_bordirl2, phb_bordirp3, phb_bordirl3, phb_bordirp4, phb_bordirl4, phb_bordirp5, phb_bordirl5, phb_bordirp6, phb_bordirl6, phb_bordirp7, phb_bordirl7, phb_bordirp8, phb_bordirl8)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      await connection.query(bordirQuery, [
        nomor,
        biayaPerCmBordir || 0,
        bordirMinCharge || 0,
        bordirCost || 0,
        bordirItems[0]?.p || 0,
        bordirItems[0]?.l || 0,
        bordirItems[1]?.p || 0,
        bordirItems[1]?.l || 0,
        bordirItems[2]?.p || 0,
        bordirItems[2]?.l || 0,
        bordirItems[3]?.p || 0,
        bordirItems[3]?.l || 0,
        bordirItems[4]?.p || 0,
        bordirItems[4]?.l || 0,
        bordirItems[5]?.p || 0,
        bordirItems[5]?.l || 0,
        bordirItems[6]?.p || 0,
        bordirItems[6]?.l || 0,
        bordirItems[7]?.p || 0,
        bordirItems[7]?.l || 0,
      ]);
    }

    await connection.query(
      `DELETE FROM tpengajuanharga_dtf WHERE phd_nomor = ?`,
      [nomor],
    );
    if (hasDtfData || biayaPerCmDtf > 0 || dtfCost > 0) {
      const dtfQuery = `
        INSERT INTO tpengajuanharga_dtf (phd_nomor, phd_cmdtf, phd_mindtf, phd_rpdtf, phd_dtfp1, phd_dtfl1, phd_dtfp2, phd_dtfl2, phd_dtfp3, phd_dtfl3, phd_dtfp4, phd_dtfl4, phd_dtfp5, phd_dtfl5, phd_dtfp6, phd_dtfl6, phd_dtfp7, phd_dtfl7, phd_dtfp8, phd_dtfl8)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      await connection.query(dtfQuery, [
        nomor,
        biayaPerCmDtf || 0,
        dtfMinCharge || 0,
        dtfCost || 0,
        dtfItems[0]?.p || 0,
        dtfItems[0]?.l || 0,
        dtfItems[1]?.p || 0,
        dtfItems[1]?.l || 0,
        dtfItems[2]?.p || 0,
        dtfItems[2]?.l || 0,
        dtfItems[3]?.p || 0,
        dtfItems[3]?.l || 0,
        dtfItems[4]?.p || 0,
        dtfItems[4]?.l || 0,
        dtfItems[5]?.p || 0,
        dtfItems[5]?.l || 0,
        dtfItems[6]?.p || 0,
        dtfItems[6]?.l || 0,
        dtfItems[7]?.p || 0,
        dtfItems[7]?.l || 0,
      ]);
    }

    await connection.commit();
    return {
      message: `Pengajuan harga ${nomor} berhasil disimpan.`,
      nomor: nomor,
      kodeBarangDraft: kodeBarangDraft,
      kodeBarangDeskripsi: kodeBarangDeskripsi,
    };
  } catch (error) {
    await connection.rollback();
    console.error("Save Proposal Error:", error);
    throw new Error(error.message || "Gagal menyimpan data ke database.");
  } finally {
    connection.release();
  }
};

module.exports = {
  generateNewProposalNumber,
  searchTshirtTypes,
  getTshirtTypeDetails,
  getDiscountByBruto,
  searchProductsByType,
  searchAdditionalCosts,
  getProposalForEdit,
  renameProposalImage,
  renameAccCustomerProof,
  finalizeStokBarang,
  finalizeCustomBarang,
  approveFinance,
  getSublimKainOptions,
  getSublimJenisJerseyOptions,
  getSublimKatalogByKategori,
  getSublimKatalog,
  resolveSublimKainWarnaKode,
  resolveSublimCelanaHarga,
  resolveSublimJerseyHarga,
  generateOrReuseSublimDraft,
  previewSublimHarga,
  saveProposal,
};
