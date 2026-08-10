const pool = require("../config/database");
const { format } = require("date-fns");

const PERUSH_KODE = "SM";
const CUS_KODE = "DC";
const CAB_KODE = "P04";
const DIVISI_KAOSAN = 3;

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

// Deteksi varian size chart dari jeniskaos (brg_jeniskaos / pbd_jeniskaos).
// Fallback ke "KAOSAN" (Kaos Polos) kalau tidak match kata kunci apa pun —
// ini varian paling umum/default untuk program Kaosan.
const VARIAN_KEYWORDS = [
  { keywords: ["ANAK"], varian: "ANAK" },
  { keywords: ["TUNIK"], varian: "TUNIK" },
  { keywords: ["POLO"], varian: "POLO" },
];
const detectVarianUkuran = (lengan, jeniskain) => {
  const lenganUpper = String(lengan || "").toUpperCase();
  const kainUpper = String(jeniskain || "").toUpperCase();

  if (lenganUpper.includes("ANAK")) return "ANAK";
  if (lenganUpper.includes("TUNIK")) return "TUNIK";
  if (kainUpper.includes("LACOS CVC")) return "POLO";

  return "KAOSAN";
};

// Prefix kode barang -> Jenis Order. LL dinormalisasi ke KO (konsisten
// dengan pola yang sudah dipakai di perencanaanProduksiService).
const extractJoKode = (kodeBarang) => {
  if (!kodeBarang) return "KO";
  const raw = (String(kodeBarang).split("-")[0] || "KO")
    .substring(0, 2)
    .toUpperCase();
  return raw === "LL" ? "KO" : raw;
};

const generateSoNomor = async (connection, perushKode, joKode) => {
  const prefix = `SO-${perushKode}-${joKode}-`;
  const [rows] = await connection.query(
    `SELECT IFNULL(MAX(CAST(SUBSTR(so_nomor, ?, 6) AS UNSIGNED)), 0) AS jumlah
     FROM kencanaprint.tsalesorder
     WHERE so_perush_kode = ? AND so_jo_kode = ? AND so_nomor LIKE ?
     FOR UPDATE`,
    [prefix.length + 1, perushKode, joKode, `${prefix}%`],
  );
  const nextVal = Number(rows[0].jumlah) + 1;
  return `${prefix}${String(nextVal).padStart(6, "0")}`;
};

/**
 * Hitung rentang dateline berdasarkan Kepentingan + Jenis Order — replikasi
 * logic yang sama dengan perencanaanProduksiService.getDatelineRange, supaya
 * konsisten dengan alur DC Planning.
 */
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

/**
 * Ambil representative data barang (untuk custom: dari draft/final yang sudah
 * di-finalize saat Acc Finance; untuk reguler: dari tbarangdc langsung).
 */
const getRepresentativeBarang = async (connection, ph, sizeRows) => {
  if (ph.ph_custom === "Y") {
    const [draftRows] = await connection.query(
      "SELECT * FROM tpengajuanharga_barang_draft WHERE pbd_nomor = ? ORDER BY pbd_id DESC LIMIT 1",
      [ph.ph_nomor],
    );
    if (draftRows.length === 0)
      throw new Error("Data kode barang draft/final tidak ditemukan.");
    const d = draftRows[0];
    if (!d.pbd_finalized_kode) {
      throw new Error(
        "Kode barang belum difinalisasi. Lakukan Acc Finance terlebih dahulu.",
      );
    }
    return {
      kode: d.pbd_finalized_kode,
      jeniskaos: d.pbd_jeniskaos,
      tipe: d.pbd_tipe,
      lengan: d.pbd_lengan,
      jeniskain: d.pbd_jeniskain,
      warna: d.pbd_warna,
    };
  }

  const [brgRows] = await connection.query(
    "SELECT brg_kode, brg_jeniskaos, brg_tipe, brg_lengan, brg_jeniskain, brg_warna FROM tbarangdc WHERE brg_kode = ? LIMIT 1",
    [sizeRows[0].phs_kode],
  );
  if (brgRows.length === 0)
    throw new Error("Kode barang reguler tidak ditemukan di master.");
  const b = brgRows[0];
  return {
    kode: b.brg_kode,
    jeniskaos: b.brg_jeniskaos,
    tipe: b.brg_tipe,
    lengan: b.brg_lengan,
    jeniskain: b.brg_jeniskain,
    warna: b.brg_warna,
  };
};

const MINIMAL_DP_PERSEN_POLOS = 30;
const MINIMAL_DP_PERSEN_CUSTOM = 50; // Bordir/DTF/Sablon Manual

/**
 * Tentukan apakah PH ini "custom produksi" (Bordir/DTF/Sablon) atau Polos —
 * dicek dari data yang sudah tersimpan, bukan dari flag ph_custom (karena
 * item Stok/reguler pun bisa dipesan dengan Bordir/DTF tambahan).
 */
const isCustomProductionType = async (phNomor) => {
  const [rows] = await pool.query(
    `SELECT
        IFNULL((SELECT phb_rpbordir FROM tpengajuanharga_bordir WHERE phb_nomor = ?), 0) AS bordirRp,
        IFNULL((SELECT phd_rpdtf FROM tpengajuanharga_dtf WHERE phd_nomor = ?), 0) AS dtfRp,
        IFNULL((SELECT COUNT(*) FROM tpengajuanharga_tambahan WHERE pht_nomor = ? AND pht_jenis LIKE 'SABLON MANUAL%'), 0) AS sablonCount
    `,
    [phNomor, phNomor, phNomor],
  );
  const r = rows[0];
  return (
    Number(r.bordirRp) > 0 || Number(r.dtfRp) > 0 || Number(r.sablonCount) > 0
  );
};

/**
 * Cek 3 syarat sebelum tombol "Generate SO" boleh muncul/dipakai:
 * 1. Status ACC_FINANCE
 * 2. Item PH ini sudah ditarik ke SO Kaosan (tso_dtl.sod_ph_nomor)
 * 3. Total DP yang nempel di SO Kaosan itu >= ketentuan minimal
 *    (30% untuk Polos, 50% untuk Bordir/DTF/Sablon Manual)
 */
const checkSoEligibility = async (phNomor) => {
  const [phRows] = await pool.query(
    "SELECT ph_status, ph_diskon FROM tpengajuanharga WHERE ph_nomor = ?",
    [phNomor],
  );
  if (phRows.length === 0) throw new Error("Pengajuan harga tidak ditemukan.");
  const ph = phRows[0];

  const isAccFinance = ph.ph_status === "ACC_FINANCE";

  const [totalRows] = await pool.query(
    `SELECT
        IFNULL((SELECT SUM(phs_jumlah * phs_harga) FROM tpengajuanharga_size WHERE phs_nomor = ?), 0) AS subtotalSize,
        IFNULL((SELECT SUM(pht_harga) FROM tpengajuanharga_tambahan WHERE pht_nomor = ?), 0) AS subtotalTambahan,
        IFNULL((SELECT phb_rpbordir FROM tpengajuanharga_bordir WHERE phb_nomor = ?), 0) AS subtotalBordir,
        IFNULL((SELECT phd_rpdtf FROM tpengajuanharga_dtf WHERE phd_nomor = ?), 0) AS subtotalDtf
    `,
    [phNomor, phNomor, phNomor, phNomor],
  );
  const t = totalRows[0];
  const totalHargaPh = Math.max(
    0,
    Number(t.subtotalSize) +
      Number(t.subtotalTambahan) +
      Number(t.subtotalBordir) +
      Number(t.subtotalDtf) -
      Number(ph.ph_diskon || 0),
  );

  const isCustomProduction = await isCustomProductionType(phNomor);
  const minimalDpPersen = isCustomProduction
    ? MINIMAL_DP_PERSEN_CUSTOM
    : MINIMAL_DP_PERSEN_POLOS;

  const [soRows] = await pool.query(
    `SELECT DISTINCT h.so_nomor
     FROM tso_dtl d
     JOIN tso_hdr h ON h.so_nomor = d.sod_so_nomor
     WHERE d.sod_ph_nomor = ?`,
    [phNomor],
  );
  const isMasukSuratPesanan = soRows.length > 0;

  let totalDp = 0;
  if (isMasukSuratPesanan) {
    const soNomors = soRows.map((r) => r.so_nomor);
    const placeholders = soNomors.map(() => "?").join(",");
    const [dpRows] = await pool.query(
      `SELECT IFNULL(SUM(sh_nominal), 0) AS totalDp
       FROM tsetor_hdr
       WHERE sh_so_nomor IN (${placeholders})`,
      soNomors,
    );
    totalDp = Number(dpRows[0].totalDp || 0);
  }

  const minimalDpNominal = Math.ceil((minimalDpPersen / 100) * totalHargaPh);
  const isDpTerpenuhi = totalHargaPh > 0 && totalDp >= minimalDpNominal;

  return {
    eligible: isAccFinance && isMasukSuratPesanan && isDpTerpenuhi,
    checks: {
      isAccFinance,
      isMasukSuratPesanan,
      isDpTerpenuhi,
    },
    isCustomProduction,
    totalHargaPh,
    totalDp,
    minimalDpNominal,
    minimalDpPersen,
    soNomorTerkait: soRows.map((r) => r.so_nomor),
  };
};

/**
 * Data prefill untuk dialog "Generate SO" — SC review/koreksi Sales &
 * Kepentingan sebelum submit. Sales di-cocokkan best-effort dari nama SC
 * (user_create Pengajuan Harga) ke kencanaprint.tsales; kalau nggak ketemu,
 * matchedSales null dan SC WAJIB pilih manual di frontend.
 */
const getSoPrefill = async (phNomor) => {
  const [headerRows] = await pool.query(
    `SELECT h.*, c.cus_nama, u.user_nama
     FROM tpengajuanharga h
     LEFT JOIN tcustomer c ON c.cus_kode = h.ph_kd_cus
     LEFT JOIN tuser u ON u.user_kode = h.user_create
     WHERE h.ph_nomor = ?`,
    [phNomor],
  );
  if (headerRows.length === 0)
    throw new Error("Pengajuan harga tidak ditemukan.");
  const ph = headerRows[0];

  const eligibility = await checkSoEligibility(phNomor);
  if (!eligibility.eligible) {
    throw new Error(
      "Pengajuan Harga belum memenuhi syarat untuk generate SO (cek status Acc Finance, Surat Pesanan, dan minimal DP).",
    );
  }

  const [sizeRows] = await pool.query(
    "SELECT phs_kode, phs_size, phs_jumlah FROM tpengajuanharga_size WHERE phs_nomor = ?",
    [phNomor],
  );
  if (sizeRows.length === 0)
    throw new Error("Detail ukuran Pengajuan Harga kosong.");

  const representative = await getRepresentativeBarang(pool, ph, sizeRows);
  const joKode = extractJoKode(representative.kode);
  const totalQty = sizeRows.reduce(
    (sum, r) => sum + Number(r.phs_jumlah || 0),
    0,
  );
  const ketUkuran = sizeRows
    .map((r) => `${r.phs_size}=${r.phs_jumlah}`)
    .join(",");

  let matchedSales = null;
  if (ph.user_nama) {
    const [exact] = await pool.query(
      "SELECT sal_kode, sal_nama FROM kencanaprint.tsales WHERE sal_nama = ? LIMIT 1",
      [ph.user_nama],
    );
    if (exact.length > 0) {
      matchedSales = exact[0];
    } else {
      const [like] = await pool.query(
        "SELECT sal_kode, sal_nama FROM kencanaprint.tsales WHERE sal_nama LIKE ? LIMIT 1",
        [`%${ph.user_nama}%`],
      );
      if (like.length > 0) matchedSales = like[0];
    }
  }

  const [kepentinganRows] = await pool.query(
    "SELECT DISTINCT kepentingan FROM kencanaprint.tspk_kepentingan ORDER BY kepentingan",
  );

  return {
    phNomor,
    kodeBarang: representative.kode,
    joKode,
    jeniskain: representative.jeniskain,
    finishing: representative.tipe,
    lengan: representative.lengan,
    jumlah: totalQty,
    ketUkuran,
    custKaosanKode: ph.ph_kd_cus,
    custKaosanNama: ph.cus_nama,
    matchedSales,
    kepentinganOptions: kepentinganRows.map((r) => r.kepentingan),
    keteranganProduksi: ph.ph_keterangan_produksi || "",
  };
};

/**
 * Generate SO Draft cross-db ke kencanaprint.tsalesorder. Berhasil generate
 * akan naikkan status Pengajuan Harga ACC_FINANCE -> ACC_DC, dengan
 * ph_ref_so_spk menyimpan nomor SO baru. Referensi balik (SO -> PH) disimpan
 * di kolom so_invdc (repurposed, sesuai keputusan kalian).
 */
const generateSalesOrder = async (phNomor, payload, user) => {
  const {
    namaSo,
    namaExt,
    kepentingan,
    salesKode,
    dateline,
    keteranganProduksi,
  } = payload;
  if (!namaSo) throw new Error("Nama SO wajib diisi.");
  if (!kepentingan) throw new Error("Kepentingan wajib dipilih.");
  if (!salesKode) throw new Error("Sales wajib dipilih.");
  if (!dateline) throw new Error("Dateline SO wajib diisi.");

  // Fallback default kalau frontend tidak mengirim (jaga-jaga)
  const finalNomorPo = `KAOSAN ${user.cabangNama || user.cabang || ""}`.trim();

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [phRows] = await connection.query(
      "SELECT * FROM tpengajuanharga WHERE ph_nomor = ? FOR UPDATE",
      [phNomor],
    );
    if (phRows.length === 0)
      throw new Error("Pengajuan harga tidak ditemukan.");
    const ph = phRows[0];
    ph.ph_nomor = phNomor;

    const eligibility = await checkSoEligibility(phNomor);
    if (!eligibility.eligible) {
      throw new Error(
        "Pengajuan Harga belum memenuhi syarat untuk generate SO (cek status Acc Finance, Surat Pesanan, dan minimal DP).",
      );
    }

    const [sizeRows] = await connection.query(
      "SELECT phs_kode, phs_size, phs_jumlah FROM tpengajuanharga_size WHERE phs_nomor = ?",
      [phNomor],
    );
    if (sizeRows.length === 0)
      throw new Error("Detail ukuran Pengajuan Harga kosong.");

    const representative = await getRepresentativeBarang(
      connection,
      ph,
      sizeRows,
    );
    const joKode = extractJoKode(representative.kode);
    const totalQty = sizeRows.reduce(
      (sum, r) => sum + Number(r.phs_jumlah || 0),
      0,
    );
    const ketUkuran = sizeRows
      .map((r) => `${r.phs_size}=${r.phs_jumlah}`)
      .join(",");
    const soNomor = await generateSoNomor(connection, PERUSH_KODE, joKode);

    const varianUkuran = detectVarianUkuran(
      representative.lengan,
      representative.jeniskain,
    );

    // 1. Header SO — so_invdc = nomor Pengajuan Harga
    await connection.query(
      `INSERT INTO kencanaprint.tsalesorder (
         so_nomor, so_tanggal, so_dateline, so_perush_kode, so_cus_kode, so_cus_kaosan, so_sal_kode,
         so_jo_kode, so_divisi, so_nama, so_nama2, so_jumlah,
         so_ukuran, so_kain, so_finishing, so_gramasi,
         so_cab, so_cabkaos, so_tipe, so_statuskerja,
         so_standar_ukuran, so_varian_ukuran,
         so_nomor_po, so_tgl_po, so_datelinepo,
         so_invdc, so_keterangan,
         so_aktif, so_close,
         user_create, date_create
       ) VALUES (
         ?, CURDATE(), ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, '',
         ?, ?, 'Premium', ?,
         'KENCANA', ?,
         ?, CURDATE(), CURDATE(),
         ?, ?,
         'Y', 0,
         ?, NOW()
       )`,
      [
        soNomor,
        dateline,
        PERUSH_KODE,
        CUS_KODE,
        ph.ph_kd_cus,
        salesKode,
        joKode,
        DIVISI_KAOSAN,
        namaSo,
        namaExt || "",
        totalQty,
        ketUkuran,
        representative.jeniskain || "",
        representative.tipe || "",
        CAB_KODE,
        CAB_KODE,
        kepentingan,
        varianUkuran,
        finalNomorPo,
        phNomor,
        keteranganProduksi || "",
        user.kode,
      ],
    );

    // 2. Detail Kaosan — reguler bisa beda kode per baris (sesuai pilihan awal
    // di tabel size PH), custom selalu 1 kode yang sama (representative.kode)
    for (const row of sizeRows) {
      if (Number(row.phs_jumlah) > 0) {
        const kodeBaris =
          ph.ph_custom === "Y" ? representative.kode : row.phs_kode;
        await connection.query(
          `INSERT INTO kencanaprint.tsalesorder_kaosan (sok_so_nomor, sok_kode, sok_ukuran, sok_qtyorder)
           VALUES (?, ?, ?, ?)`,
          [soNomor, kodeBaris, row.phs_size, row.phs_jumlah],
        );
      }
    }

    // 3. Detail Size (measurement) — Std. Kencana, fallback 0 kalau size tidak
    // ada di tabel standar (mis. OVERSIZED). tukuran_standar LOKAL di Retail DB.
    const kategori = JO_KATEGORI[joKode];
    let standarMap = {};
    if (kategori) {
      const kategoriList =
        kategori === "WEARPACK" ? ["ATASAN", "BAWAHAN"] : [kategori];
      const placeholders = kategoriList.map(() => "?").join(",");
      const [standarRows] = await connection.query(
        `SELECT * FROM tukuran_standar WHERE ts_kategori IN (${placeholders}) AND ts_varian = ?`,
        [...kategoriList, varianUkuran],
      );
      for (const row of standarRows) standarMap[row.ts_ukuran] = row;
    }

    for (const row of sizeRows) {
      if (Number(row.phs_jumlah) > 0) {
        const d = standarMap[row.phs_size] || {};
        await connection.query(
          `INSERT INTO kencanaprint.tsalesorder_size
            (sos_so_nomor, sos_size, sos_qty,
             sos_ld, sos_pb, sos_pl_pendek, sos_pl_panjang, sos_p_bahu,
             sos_l_lengan, sos_l_manset, sos_l_pinggang, sos_p_celana,
             sos_l_panggul, sos_l_paha, sos_pesak, sos_l_lutut, sos_l_bawah)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            soNomor,
            row.phs_size,
            row.phs_jumlah,
            Number(d.ts_ld) || 0,
            Number(d.ts_pb) || 0,
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
    }

    // 4. Naikkan status PH -> MENUNGGU_DC, sekalian simpan keterangan produksi
    // untuk riwayat (kolom yang sama juga jadi so_keterangan di atas).
    await connection.query(
      "UPDATE tpengajuanharga SET ph_status = 'MENUNGGU_DC', ph_status_updated = NOW(), ph_ref_so_spk = ?, ph_keterangan_produksi = ? WHERE ph_nomor = ?",
      [soNomor, keteranganProduksi || null, phNomor],
    );
    await connection.query(
      `INSERT INTO tpengajuanharga_status_log
        (phl_nomor, phl_status_from, phl_status_to, phl_user, phl_source_system, phl_ref_nomor, phl_keterangan)
       VALUES (?, 'ACC_FINANCE', 'MENUNGGU_DC', ?, 'KAOSAN', ?, ?)`,
      [
        phNomor,
        user.kode,
        soNomor,
        `SO Draft dibuat: ${soNomor}, menunggu validasi DC`,
      ],
    );

    await connection.commit();
    return {
      soNomor,
      message: `SO ${soNomor} berhasil dibuat (Draft, menunggu validasi DC).`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  getSoPrefill,
  checkSoEligibility,
  generateSalesOrder,
  getDatelineRange,
};
