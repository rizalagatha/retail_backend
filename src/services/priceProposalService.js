const pool = require("../config/database");

// ==================== STATUS DEFINITION ====================
const STATUS = {
  DRAFT: "DRAFT",
  ACC_CUSTOMER: "ACC_CUSTOMER",
  ACC_FINANCE: "ACC_FINANCE",
  MENUNGGU_DC: "MENUNGGU_DC",
  ACC_DC: "ACC_DC",
  PRODUKSI: "PRODUKSI",
  BARANG_DITERIMA_DC: "BARANG_DITERIMA_DC",
  READY_STORE: "READY_STORE",
  CLOSED: "CLOSED",
  REJECTED: "REJECTED",
  DIBATALKAN: "DIBATALKAN",
};

const STATUS_LABEL = {
  DRAFT: "Draft",
  ACC_CUSTOMER: "Acc Customer",
  ACC_FINANCE: "Acc Finance",
  MENUNGGU_DC: "Menunggu Validasi DC",
  ACC_DC: "Acc DC",
  PRODUKSI: "Produksi",
  BARANG_DITERIMA_DC: "Barang Diterima DC",
  READY_STORE: "Ready di Store",
  CLOSED: "Closed (Invoiced)",
  REJECTED: "Ditolak",
  DIBATALKAN: "Dibatalkan",
};

// State machine guard: dari status apa boleh pindah ke status apa
const ALLOWED_TRANSITIONS = {
  [STATUS.DRAFT]: [STATUS.ACC_CUSTOMER],
  [STATUS.ACC_CUSTOMER]: [
    STATUS.ACC_FINANCE,
    STATUS.REJECTED,
    STATUS.DIBATALKAN,
  ],
  [STATUS.ACC_FINANCE]: [
    STATUS.MENUNGGU_DC,
    STATUS.REJECTED,
    STATUS.DIBATALKAN,
  ],
  [STATUS.MENUNGGU_DC]: [STATUS.ACC_DC, STATUS.REJECTED, STATUS.DIBATALKAN],
  // [DIUBAH] ACC_DC & PRODUKSI bisa loncat langsung ke READY_STORE — scan+mutasi
  // di Store adalah sinyal otoritatif, nggak wajib nunggu tracking produksi
  // MANKSI (SPK PPIC/STBJ) yang mungkin belum pernah tercatat di test/praktik.
  [STATUS.ACC_DC]: [
    STATUS.PRODUKSI,
    STATUS.BARANG_DITERIMA_DC,
    STATUS.READY_STORE,
    STATUS.REJECTED,
    STATUS.DIBATALKAN,
  ],
  [STATUS.PRODUKSI]: [
    STATUS.BARANG_DITERIMA_DC,
    STATUS.READY_STORE,
    STATUS.DIBATALKAN,
  ],
  [STATUS.BARANG_DITERIMA_DC]: [STATUS.READY_STORE, STATUS.DIBATALKAN],
  [STATUS.READY_STORE]: [STATUS.CLOSED, STATUS.DIBATALKAN],
  [STATUS.REJECTED]: [STATUS.DRAFT],
  [STATUS.CLOSED]: [],
  [STATUS.DIBATALKAN]: [],
};

/**
 * Mengambil daftar pengajuan harga berdasarkan filter.
 * Mereplikasi query dari TfrmBrowPengajuanHarga.btnRefreshClick,
 * ditambah kolom status baru.
 */
const getPriceProposals = async (filters) => {
  const { startDate, endDate, cabang, status } = filters;
  const belumApproval =
    filters.belumApproval === "true" || filters.belumApproval === true;

  let params = [startDate, endDate];

  let query = `
        SELECT 
          h.ph_nomor AS nomor,
          h.ph_tanggal AS tanggal,
          h.ph_kd_cus AS kdcus,
          c.cus_nama AS customer,
          CASE 
            WHEN h.ph_sublim_kain IS NOT NULL THEN h.ph_sublim_kain
            ELSE h.ph_jenis 
          END AS jenisKaos,
          h.ph_ket AS keterangan,
          h.ph_apv AS approval,
          -- [FIX] Data lama (dibuat sebelum kolom ph_status ada): status tetap
          -- 'DRAFT'/NULL di DB, tapi ph_apv sudah terisi nama approver. Tandai
          -- sebagai LEGACY_APPROVED khusus untuk tampilan — data asli TIDAK diubah.
          CASE 
            WHEN (h.ph_status IS NULL OR h.ph_status = 'DRAFT')
              AND h.ph_apv IS NOT NULL AND h.ph_apv <> ''
            THEN 'LEGACY_APPROVED'
            ELSE IFNULL(h.ph_status, 'DRAFT')
          END AS status,
          h.ph_status_updated AS statusUpdated,
          h.ph_ref_so_spk AS refSoSpk,
          h.ph_ref_invoice AS refInvoice,
          (SELECT sod_so_nomor FROM tso_dtl WHERE sod_ph_nomor = h.ph_nomor LIMIT 1) AS soKaosanNomor,
          h.ph_cab AS cabang,
          h.user_create AS created,
          CASE 
            WHEN h.ph_sublim_kain IS NOT NULL THEN 'Sublim'
            WHEN h.ph_custom = 'Y' THEN 'Custom'
            ELSE 'Stok'
          END AS ketersediaan,
          COALESCE(
            (
              SELECT pbd_kode_barang_draft FROM tpengajuanharga_barang_draft 
              WHERE pbd_nomor = h.ph_nomor AND pbd_kategori = 'UTAMA'
              ORDER BY pbd_id DESC LIMIT 1
            ),
            h.ph_kode_barang_draft
          ) AS kodeBarangDraft,
          (
            SELECT pbd_finalized_kode FROM tpengajuanharga_barang_draft 
            WHERE pbd_nomor = h.ph_nomor AND pbd_kategori = 'UTAMA' AND pbd_finalized_kode IS NOT NULL 
            ORDER BY pbd_id DESC LIMIT 1
          ) AS kodeBarangFinal,
          h.ph_celana_kode_barang_draft AS kodeCelanaDraft
      FROM tpengajuanharga h
      LEFT JOIN tcustomer c ON c.cus_kode = h.ph_kd_cus
      WHERE h.ph_tanggal BETWEEN ? AND ?
    `;

  if (cabang && cabang !== "ALL") {
    query += " AND h.ph_cab = ?";
    params.push(cabang);
  }

  if (status) {
    query += " AND h.ph_status = ?";
    params.push(status);
  } else if (belumApproval) {
    query += " AND h.ph_status = ?";
    params.push(STATUS.DRAFT);
  }

  query += " ORDER BY h.ph_tanggal, h.ph_nomor";

  const [rows] = await pool.query(query, params);
  return rows;
};

// Urutan size resmi buat sorting tampilan detail — mirror dari priceProposalFormService
const SIZE_ORDER_FOR_DETAIL = [
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
const sizeOrderIdx = (size) => {
  const idx = SIZE_ORDER_FOR_DETAIL.indexOf(
    (size || "").toString().trim().toUpperCase(),
  );
  return idx === -1 ? SIZE_ORDER_FOR_DETAIL.length : idx;
};

/**
 * Detail per-ukuran (qty & harga) untuk expand row di browse — dipisah dari
 * getPriceProposals (yang cuma header) supaya lazy-load, sama pola dengan
 * OfferView.loadDetails.
 */
const getSizeDetails = async (nomor) => {
  const [rows] = await pool.query(
    `SELECT
        s.phs_size AS ukuran,
        s.phs_jumlah AS qty,
        s.phs_harga AS hargaDasar,
        (s.phs_harga + IFNULL(t.tambahan, 0) + IFNULL(brd.bordir, 0) + IFNULL(dt.dtf, 0)) AS harga,
        IFNULL(
          NULLIF(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), ""),
          pbd.pbd_deskripsi
        ) AS nama
    FROM tpengajuanharga_size s
    LEFT JOIN tbarangdc a ON a.brg_kode = s.phs_kode
    LEFT JOIN tpengajuanharga_barang_draft pbd ON pbd.pbd_kode_barang_draft = s.phs_kode
    LEFT JOIN (SELECT pht_nomor, SUM(pht_harga) AS tambahan FROM tpengajuanharga_tambahan GROUP BY pht_nomor) t ON t.pht_nomor = s.phs_nomor
    LEFT JOIN (SELECT phb_nomor, phb_rpbordir AS bordir FROM tpengajuanharga_bordir GROUP BY phb_nomor) brd ON brd.phb_nomor = s.phs_nomor
    LEFT JOIN (SELECT phd_nomor, phd_rpdtf AS dtf FROM tpengajuanharga_dtf GROUP BY phd_nomor) dt ON dt.phd_nomor = s.phs_nomor
    WHERE s.phs_nomor = ?`,
    [nomor],
  );
  return rows.sort((a, b) => sizeOrderIdx(a.ukuran) - sizeOrderIdx(b.ukuran));
};

const getProposalDetails = async (nomor) => {
  const query = `SELECT * FROM tpengajuanharga WHERE ph_nomor = ?`;
  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) {
    throw new Error("Data tidak ditemukan");
  }
  return rows[0];
};

const getStatusHistory = async (nomor) => {
  const query = `
    SELECT phl_id AS id, phl_status_from AS statusFrom, phl_status_to AS statusTo,
           phl_tanggal AS tanggal, phl_user AS user, phl_source_system AS sourceSystem,
           phl_ref_nomor AS refNomor, phl_keterangan AS keterangan
    FROM tpengajuanharga_status_log
    WHERE phl_nomor = ?
    ORDER BY phl_tanggal ASC, phl_id ASC
  `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

/**
 * Ambil status ph_status untuk sekumpulan nomor PH sekaligus — dipakai
 * frontend SO Form untuk validasi hapus item (item dengan PH yang sudah
 * ACC_DC ke atas tidak boleh dihapus dari SO karena DC sudah alokasikan
 * produksinya).
 */
const getStatusesForNomors = async (nomors) => {
  if (!nomors || nomors.length === 0) return {};

  const placeholders = nomors.map(() => "?").join(",");
  const [rows] = await pool.query(
    `SELECT ph_nomor, ph_status FROM tpengajuanharga WHERE ph_nomor IN (${placeholders})`,
    nomors,
  );

  const map = {};
  rows.forEach((r) => {
    map[r.ph_nomor] = r.ph_status || STATUS.DRAFT;
  });
  return map;
};

/**
 * Fungsi inti perubahan status — semua approve/reject/produksi/dst lewat sini
 * supaya validasi transisi & logging konsisten di 1 tempat.
 *
 * @param {string} nomor
 * @param {string} targetStatus - salah satu dari STATUS
 * @param {object} options
 * @param {string} options.user - username pelaku
 * @param {string} [options.sourceSystem='KAOSAN'] - 'KAOSAN' | 'MANKSI'
 * @param {string} [options.refNomor] - nomor dokumen pemicu (mis. nomor SPK)
 * @param {string} [options.keterangan] - catatan (wajib untuk reject)
 * @param {string} [options.refSoSpk] - diisi kalau status baru PRODUKSI, simpan link ke SO SPK MANKSI
 * @param {string} [options.refInvoice] - diisi kalau status baru CLOSED, simpan nomor invoice
 */
const changeStatus = async (nomor, targetStatus, options = {}) => {
  const {
    user = null,
    sourceSystem = "KAOSAN",
    refNomor = null,
    keterangan = null,
    refSoSpk = null,
    refInvoice = null,
  } = options;

  if (!Object.values(STATUS).includes(targetStatus)) {
    throw new Error(`Status tujuan tidak valid: ${targetStatus}`);
  }

  if (
    (targetStatus === STATUS.REJECTED || targetStatus === STATUS.DIBATALKAN) &&
    !keterangan
  ) {
    throw new Error(
      "Keterangan/alasan wajib diisi saat menolak atau menutup pengajuan harga.",
    );
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      "SELECT ph_status FROM tpengajuanharga WHERE ph_nomor = ? FOR UPDATE",
      [nomor],
    );
    if (rows.length === 0) {
      throw new Error("Pengajuan harga tidak ditemukan.");
    }

    const currentStatus = rows[0].ph_status || STATUS.DRAFT;
    const allowedNext = ALLOWED_TRANSITIONS[currentStatus] || [];

    if (!allowedNext.includes(targetStatus)) {
      throw new Error(
        `Transisi status tidak diperbolehkan: ${STATUS_LABEL[currentStatus] || currentStatus} → ${
          STATUS_LABEL[targetStatus] || targetStatus
        }`,
      );
    }

    const updateFields = ["ph_status = ?", "ph_status_updated = NOW()"];
    const updateParams = [targetStatus];

    // Backward-compat: logic lama (tarik ke Penawaran/SO) masih pakai ph_apv
    if (targetStatus === STATUS.ACC_FINANCE) {
      updateFields.push("ph_apv = ?");
      updateParams.push(user || "SYSTEM");
    }
    if (targetStatus === STATUS.REJECTED) {
      updateFields.push("ph_apv = NULL");
    }
    if (refSoSpk) {
      updateFields.push("ph_ref_so_spk = ?");
      updateParams.push(refSoSpk);
    }
    if (refInvoice) {
      updateFields.push("ph_ref_invoice = ?");
      updateParams.push(refInvoice);
    }

    updateParams.push(nomor);
    await conn.query(
      `UPDATE tpengajuanharga SET ${updateFields.join(", ")} WHERE ph_nomor = ?`,
      updateParams,
    );

    await conn.query(
      `INSERT INTO tpengajuanharga_status_log
        (phl_nomor, phl_status_from, phl_status_to, phl_user, phl_source_system, phl_ref_nomor, phl_keterangan)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        nomor,
        currentStatus,
        targetStatus,
        user,
        sourceSystem,
        refNomor,
        keterangan,
      ],
    );

    await conn.commit();
    return { nomor, statusFrom: currentStatus, statusTo: targetStatus };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ==================== WRAPPER PER TAHAP ====================
const approveCustomer = (nomor, user, keterangan) =>
  changeStatus(nomor, STATUS.ACC_CUSTOMER, {
    user,
    sourceSystem: "KAOSAN",
    keterangan,
  });

const approveFinance = (nomor, user, keterangan) =>
  changeStatus(nomor, STATUS.ACC_FINANCE, {
    user,
    sourceSystem: "KAOSAN",
    keterangan,
  });

const approveDc = (nomor, user, keterangan) =>
  changeStatus(nomor, STATUS.ACC_DC, {
    user,
    sourceSystem: "KAOSAN",
    keterangan,
  });

const rejectProposal = (nomor, user, keterangan) =>
  changeStatus(nomor, STATUS.REJECTED, {
    user,
    sourceSystem: "KAOSAN",
    keterangan,
  });

// Close manual — dipakai untuk status selain DRAFT, WAJIB lewat
// otorisasi SPV (authNomor dari AuthorizationModal frontend, disimpan
// sebagai refNomor di log untuk jejak audit siapa yang mengotorisasi).
const closeProposal = (nomor, user, keterangan, authNomor) =>
  changeStatus(nomor, STATUS.DIBATALKAN, {
    user,
    sourceSystem: "KAOSAN",
    keterangan,
    refNomor: authNomor,
  });

// Dipanggil dari MANKSI (lewat endpoint internal) saat SPK Produksi diproses
const markProduksi = (nomor, { user, refNomor, keterangan, refSoSpk }) =>
  changeStatus(nomor, STATUS.PRODUKSI, {
    user,
    sourceSystem: "MANKSI",
    refNomor,
    keterangan,
    refSoSpk,
  });

const markBarangJadi = (nomor, { user, refNomor, keterangan }) =>
  changeStatus(nomor, STATUS.BARANG_JADI, {
    user,
    sourceSystem: "MANKSI",
    refNomor,
    keterangan,
  });

// Dipanggil dari Kaosan saat scan barcode ready (existing flow)
const markReadyStore = (nomor, user, keterangan) =>
  changeStatus(nomor, STATUS.READY_STORE, {
    user,
    sourceSystem: "KAOSAN",
    keterangan,
  });

const markClosed = (nomor, user, refInvoice) =>
  changeStatus(nomor, STATUS.CLOSED, {
    user,
    sourceSystem: "KAOSAN",
    refInvoice,
  });

/**
 * Sinkronisasi status MENUNGGU_DC -> ACC_DC berdasarkan kolom so_cmo di
 * kencanaprint.tsalesorder (satu server MariaDB yang sama, jadi cukup
 * query cross-db langsung tanpa perlu HTTP call ke MANKSI). Dipanggil
 * otomatis tiap kali browse di-fetch, supaya status selalu up-to-date
 * tanpa perlu tombol manual.
 */
const syncDcApprovalStatus = async () => {
  const [rows] = await pool.query(
    `SELECT h.ph_nomor, h.ph_ref_so_spk, s.so_cmo
     FROM tpengajuanharga h
     JOIN kencanaprint.tsalesorder s ON s.so_nomor = h.ph_ref_so_spk
     WHERE h.ph_status = 'MENUNGGU_DC' AND s.so_cmo IS NOT NULL AND s.so_cmo <> ''`,
  );

  for (const row of rows) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [statusRows] = await connection.query(
        "SELECT ph_status FROM tpengajuanharga WHERE ph_nomor = ? FOR UPDATE",
        [row.ph_nomor],
      );
      if (
        statusRows.length === 0 ||
        statusRows[0].ph_status !== "MENUNGGU_DC"
      ) {
        await connection.rollback();
        continue; // Sudah berubah status di antara SELECT awal dan sekarang, skip
      }

      await connection.query(
        "UPDATE tpengajuanharga SET ph_status = 'ACC_DC', ph_status_updated = NOW() WHERE ph_nomor = ?",
        [row.ph_nomor],
      );
      await connection.query(
        `INSERT INTO tpengajuanharga_status_log
          (phl_nomor, phl_status_from, phl_status_to, phl_user, phl_source_system, phl_ref_nomor, phl_keterangan)
         VALUES (?, 'MENUNGGU_DC', 'ACC_DC', ?, 'MANKSI', ?, ?)`,
        [
          row.ph_nomor,
          row.so_cmo,
          row.ph_ref_so_spk,
          `SO ${row.ph_ref_so_spk} disetujui DC (CMO: ${row.so_cmo})`,
        ],
      );

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      console.error(
        `Gagal sync DC approval untuk ${row.ph_nomor}:`,
        err.message,
      );
      // Sengaja tidak dilempar ke atas — kalau 1 baris gagal sync, jangan
      // sampai bikin seluruh browse Pengajuan Harga error.
    } finally {
      connection.release();
    }
  }

  return { synced: rows.length };
};

/**
 * Helper generic buat jalanin 1 baris transisi status dengan lock + log,
 * dipakai oleh kedua fungsi sync di bawah supaya nggak duplikasi kode.
 */
const applySyncTransition = async ({
  phNomor,
  expectedStatuses,
  targetStatus,
  sourceSystem,
  keterangan,
}) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [statusRows] = await connection.query(
      "SELECT ph_status FROM tpengajuanharga WHERE ph_nomor = ? FOR UPDATE",
      [phNomor],
    );
    if (
      statusRows.length === 0 ||
      !expectedStatuses.includes(statusRows[0].ph_status)
    ) {
      await connection.rollback();
      return false; // Sudah berubah status di antara SELECT dan sekarang, atau status tidak sesuai lagi
    }
    const currentStatus = statusRows[0].ph_status;

    await connection.query(
      "UPDATE tpengajuanharga SET ph_status = ?, ph_status_updated = NOW() WHERE ph_nomor = ?",
      [targetStatus, phNomor],
    );
    await connection.query(
      `INSERT INTO tpengajuanharga_status_log
        (phl_nomor, phl_status_from, phl_status_to, phl_source_system, phl_keterangan)
       VALUES (?, ?, ?, ?, ?)`,
      [phNomor, currentStatus, targetStatus, sourceSystem, keterangan],
    );

    await connection.commit();
    return true;
  } catch (err) {
    await connection.rollback();
    console.error(`Gagal sync status untuk ${phNomor}:`, err.message);
    return false;
  } finally {
    connection.release();
  }
};

/**
 * Sync ACC_DC -> PRODUKSI: dicek dari kencanaprint.tspk, apakah SO ini
 * (ph_ref_so_spk) sudah dibuatkan SPK PPIC (spk_is_so = 0, spk_so_ref = SO
 * kita). SPK PPIC-nya sendiri punya nomor terpisah (format SPK-{perush}-{jo}-
 * xxxxxx), disimpan sekalian buat keperluan matching STBJ di tahap berikutnya.
 */
const syncProduksiStatus = async () => {
  const [rows] = await pool.query(`
    SELECT h.ph_nomor, h.ph_ref_so_spk, s.spk_nomor AS spkPpicNomor
    FROM tpengajuanharga h
    JOIN kencanaprint.tspk s ON s.spk_so_ref = h.ph_ref_so_spk AND s.spk_is_so = 0
    WHERE h.ph_status IN ('MENUNGGU_DC', 'ACC_DC')
      AND h.ph_ref_so_spk IS NOT NULL AND h.ph_ref_so_spk <> ''
  `);

  let synced = 0;
  for (const row of rows) {
    const ok = await applySyncTransition({
      phNomor: row.ph_nomor,
      expectedStatuses: ["MENUNGGU_DC", "ACC_DC"],
      targetStatus: "PRODUKSI",
      sourceSystem: "MANKSI",
      keterangan: `SPK PPIC dibuat: ${row.spkPpicNomor}, dari SO ${row.ph_ref_so_spk}`,
    });
    if (ok) synced++;
  }
  return { synced };
};

/**
 * Sync PRODUKSI -> BARANG_DITERIMA_DC. STBJ (tdc_stbj_dtl.tsd_spk_nomor)
 * mereferensikan NOMOR SPK PPIC, bukan nomor SO langsung — jadi perlu 1 join
 * tambahan lewat kencanaprint.tspk (spk_so_ref = ph_ref_so_spk) buat
 * nerjemahin SO -> SPK PPIC dulu, baru match kode barangnya.
 */
const syncBarangDiterimaDcStatus = async () => {
  const [rows] = await pool.query(`
    SELECT * FROM (
      SELECT h.ph_nomor, h.ph_ref_so_spk,
        COALESCE(
          pbd.pbd_finalized_kode,
          (SELECT phs_kode FROM tpengajuanharga_size WHERE phs_nomor = h.ph_nomor LIMIT 1)
        ) AS kodeBarang
      FROM tpengajuanharga h
      LEFT JOIN tpengajuanharga_barang_draft pbd 
        ON pbd.pbd_nomor = h.ph_nomor AND pbd.pbd_finalized_kode IS NOT NULL
      WHERE h.ph_status = 'PRODUKSI'
        AND h.ph_ref_so_spk IS NOT NULL AND h.ph_ref_so_spk <> ''
    ) x
    WHERE x.kodeBarang IS NOT NULL AND EXISTS (
      SELECT 1 FROM tdc_stbj_dtl d
      JOIN kencanaprint.tspk s ON s.spk_nomor = d.tsd_spk_nomor
      WHERE s.spk_so_ref = x.ph_ref_so_spk AND s.spk_is_so = 0 AND d.tsd_kode = x.kodeBarang
    )
  `);

  let synced = 0;
  for (const row of rows) {
    const ok = await applySyncTransition({
      phNomor: row.ph_nomor,
      expectedStatuses: ["PRODUKSI"],
      targetStatus: "BARANG_DITERIMA_DC",
      sourceSystem: "DC",
      keterangan: `Barang (${row.kodeBarang}) diterima DC dari produksi, SO: ${row.ph_ref_so_spk}`,
    });
    if (ok) synced++;
  }
  return { synced };
};

/**
 * Sync BARANG_DITERIMA_DC -> READY_STORE. Dicek langsung dari baris tso_dtl
 * milik PH ini (sod_ph_nomor = ph_nomor) — presisi per item, bukan cuma
 * match kode barang generik. Syarat "Ready": SEMUA baris item PH tsb di
 * Surat Pesanan sudah (1) discan penuh (sod_scanned >= sod_jumlah) DAN
 * (2) sudah dimutasi ke stok pesanan (tmasterstokso, match SO+kode+ukuran).
 */
const syncReadyStoreStatus = async () => {
  const [rows] = await pool.query(`
    SELECT DISTINCT h.ph_nomor
    FROM tpengajuanharga h
    WHERE h.ph_status IN ('ACC_DC', 'PRODUKSI', 'BARANG_DITERIMA_DC')
      AND EXISTS (
        SELECT 1 FROM tso_dtl d WHERE d.sod_ph_nomor = h.ph_nomor
      )
      AND NOT EXISTS (
        SELECT 1 FROM tso_dtl d
        WHERE d.sod_ph_nomor = h.ph_nomor
          AND (
            d.sod_scanned < d.sod_jumlah
            OR IFNULL((
              SELECT SUM(m.mst_stok_in - m.mst_stok_out)
              FROM tmasterstokso m
              WHERE m.mst_aktif = 'Y'
                AND m.mst_brg_kode = d.sod_kode
                AND m.mst_ukuran = d.sod_ukuran
                AND m.mst_nomor_so = d.sod_so_nomor
            ), 0) < d.sod_jumlah
          )
      )
  `);

  let synced = 0;
  for (const row of rows) {
    const ok = await applySyncTransition({
      phNomor: row.ph_nomor,
      expectedStatuses: ["ACC_DC", "PRODUKSI", "BARANG_DITERIMA_DC"],
      targetStatus: "READY_STORE",
      sourceSystem: "STORE",
      keterangan:
        "Semua item sudah discan & dimutasi ke stok pesanan di Store.",
    });
    if (ok) synced++;
  }
  return { synced };
};

const deleteProposal = async (nomor) => {
  // Hanya boleh hapus kalau masih DRAFT — begitu sudah masuk alur approval,
  // hapus bisa bikin data di tahap-tahap berikutnya nyangkut/orphan.
  const [rows] = await pool.query(
    "SELECT ph_status FROM tpengajuanharga WHERE ph_nomor = ?",
    [nomor],
  );
  if (rows.length === 0) {
    throw new Error("Gagal menghapus data, nomor tidak ditemukan.");
  }
  if (rows[0].ph_status && rows[0].ph_status !== STATUS.DRAFT) {
    throw new Error(
      `Pengajuan harga dengan status "${STATUS_LABEL[rows[0].ph_status]}" tidak bisa dihapus, harus di-reject dulu ke Draft.`,
    );
  }

  const query = `DELETE FROM tpengajuanharga WHERE ph_nomor = ?`;
  const [result] = await pool.query(query, [nomor]);

  if (result.affectedRows === 0) {
    throw new Error("Gagal menghapus data, nomor tidak ditemukan.");
  }
  return { message: "Pengajuan harga berhasil dihapus." };
};

module.exports = {
  STATUS,
  STATUS_LABEL,
  ALLOWED_TRANSITIONS,
  getPriceProposals,
  getSizeDetails,
  getProposalDetails,
  getStatusHistory,
  getStatusesForNomors,
  changeStatus,
  approveCustomer,
  approveFinance,
  approveDc,
  rejectProposal,
  closeProposal,
  markProduksi,
  markBarangJadi,
  markReadyStore,
  markClosed,
  syncDcApprovalStatus,
  syncProduksiStatus,
  syncBarangDiterimaDcStatus,
  syncReadyStoreStatus,
  deleteProposal,
};
