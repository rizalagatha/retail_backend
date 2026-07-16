const pool = require("../config/database");

const buildBranchFilter = (cabang, params, targetColumn) => {
  if (cabang === "ALL") {
    return `AND ${targetColumn} NOT IN ('KPR','KON')`;
  }
  if (cabang === "KDC") {
    return `AND ${targetColumn} IN (SELECT gdg_kode FROM tgudang WHERE gdg_dc = 1) AND ${targetColumn} NOT IN ('KPR','KON')`;
  }
  params.push(cabang);
  return `AND ${targetColumn} = ?`;
};

const PEN_NOMINAL_SUBQUERY = `
  (
    SELECT ROUND(
      SUM(dd.pend_jumlah * (dd.pend_harga - dd.pend_diskon)) - hh.pen_disc
      + (hh.pen_ppn / 100 * (SUM(dd.pend_jumlah * (dd.pend_harga - dd.pend_diskon)) - hh.pen_disc))
      + hh.pen_bkrm
    )
    FROM tpenawaran_dtl dd
    WHERE dd.pend_nomor = hh.pen_nomor
  )
`;

const SO_NOMINAL_SUBQUERY = `
  (
    SELECT ROUND(
      SUM(sd.sod_jumlah * (sd.sod_harga - sd.sod_diskon)) - shh.so_disc
      + (shh.so_ppn / 100 * (SUM(sd.sod_jumlah * (sd.sod_harga - sd.sod_diskon)) - shh.so_disc))
      + shh.so_bkrm
    )
    FROM tso_dtl sd
    WHERE sd.sod_so_nomor = shh.so_nomor
  )
`;

/**
 * Penawaran yang masih OPEN = belum ada SO aktif yang mereferensikannya,
 * DAN belum ditutup manual (pen_alasan kosong, lihat closeOffer() di offerService.js).
 */
const getOpenPenawaranPerUser = async (
  startDate,
  endDate,
  cabang,
  userCreate,
) => {
  const params = [startDate, endDate];
  const branchFilter = buildBranchFilter(cabang, params, "h.pen_cab");

  let userFilter = "";
  if (userCreate && userCreate !== "ALL") {
    userFilter = "AND h.user_create = ?";
    params.push(userCreate);
  }

  const query = `
    SELECT
      h.user_create AS userCreate,
      COUNT(DISTINCT h.pen_nomor) AS jmlPenawaranOpen,
      ROUND(SUM(PEN_NOM.nominal), 2) AS nominalPenawaranOpen,
      ROUND(AVG(DATEDIFF(CURDATE(), h.pen_tanggal)), 1) AS rataRataUmurPenawaran,
      MAX(DATEDIFF(CURDATE(), h.pen_tanggal)) AS umurPenawaranTertua
    FROM tpenawaran_hdr h
    LEFT JOIN tso_hdr so ON so.so_pen_nomor = h.pen_nomor AND so.so_aktif = 'Y'
    LEFT JOIN (
      SELECT hh.pen_nomor, ${PEN_NOMINAL_SUBQUERY} AS nominal
      FROM tpenawaran_hdr hh
    ) PEN_NOM ON PEN_NOM.pen_nomor = h.pen_nomor
    WHERE h.pen_tanggal BETWEEN ? AND ?
      AND so.so_nomor IS NULL
      AND (h.pen_alasan IS NULL OR h.pen_alasan = '')
      ${branchFilter}
      ${userFilter}
    GROUP BY h.user_create
    ORDER BY jmlPenawaranOpen DESC
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * SO yang masih OPEN = aktif, belum di-close (so_close = 0), dan belum ada Invoice-nya.
 * Filter tanggal & cabang pakai kolom milik SO sendiri (so_tanggal, so_cab) — bukan
 * warisan dari Penawaran — karena SO bisa lahir di luar rentang tanggal Penawarannya.
 */
const getOpenSoPerUser = async (startDate, endDate, cabang, userCreate) => {
  const params = [startDate, endDate];
  const branchFilter = buildBranchFilter(cabang, params, "so.so_cab");

  let userFilter = "";
  if (userCreate && userCreate !== "ALL") {
    userFilter = "AND so.user_create = ?";
    params.push(userCreate);
  }

  const query = `
    SELECT
      so.user_create AS userCreate,
      COUNT(DISTINCT so.so_nomor) AS jmlSoOpen,
      ROUND(SUM(SO_NOM.nominal), 2) AS nominalSoOpen,
      ROUND(AVG(DATEDIFF(CURDATE(), so.so_tanggal)), 1) AS rataRataUmurSo,
      MAX(DATEDIFF(CURDATE(), so.so_tanggal)) AS umurSoTertua
    FROM tso_hdr so
    LEFT JOIN tinv_hdr inv ON inv.inv_nomor_so = so.so_nomor
    LEFT JOIN (
      SELECT shh.so_nomor, ${SO_NOMINAL_SUBQUERY} AS nominal
      FROM tso_hdr shh WHERE shh.so_aktif = 'Y'
    ) SO_NOM ON SO_NOM.so_nomor = so.so_nomor
    WHERE so.so_tanggal BETWEEN ? AND ?
      AND so.so_aktif = 'Y'
      AND so.so_close = 0
      AND inv.inv_nomor IS NULL
      ${branchFilter}
      ${userFilter}
    GROUP BY so.user_create
    ORDER BY jmlSoOpen DESC
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Breakdown kunjungan per sumber_dokumen + konversi PRESISI:
 * cek langsung apakah nomor Penawaran dari kunjungan itu sudah punya SO,
 * pakai nomor_dokumen sebagai penghubung — bukan estimasi.
 */
const getKunjunganBreakdown = async (
  startDate,
  endDate,
  cabang,
  userCreate,
) => {
  const params = [startDate, endDate];
  const branchFilter = buildBranchFilter(cabang, params, "k.cabang");

  let userFilter = "";
  if (userCreate && userCreate !== "ALL") {
    userFilter = "AND k.user_create = ?";
    params.push(userCreate);
  }

  const query = `
    SELECT
      k.user_create AS userCreate,
      COUNT(DISTINCT CASE WHEN k.sumber_dokumen = 'PENAWARAN' THEN k.nomor_dokumen END) AS kunjunganPenawaran,
      COUNT(DISTINCT CASE WHEN k.sumber_dokumen = 'SO' THEN k.nomor_dokumen END) AS kunjunganSO,
      COUNT(DISTINCT CASE WHEN k.sumber_dokumen = 'INVOICE' THEN k.nomor_dokumen END) AS kunjunganInvoiceLangsung,
      COUNT(DISTINCT CASE
        WHEN k.sumber_dokumen = 'PENAWARAN'
         AND EXISTS (
           SELECT 1 FROM tso_hdr so2
           WHERE so2.so_pen_nomor = k.nomor_dokumen AND so2.so_aktif = 'Y'
         )
        THEN k.nomor_dokumen
      END) AS penawaranKunjunganJadiSo
    FROM tkunjungan_customer k
    WHERE k.tanggal BETWEEN ? AND ?
    ${branchFilter}
    ${userFilter}
    GROUP BY k.user_create
  `;
  const [rows] = await pool.query(query, params);
  return rows.map((r) => ({
    ...r,
    konversiPenawaranKeSo:
      r.kunjunganPenawaran > 0
        ? Number(
            ((r.penawaranKunjunganJadiSo / r.kunjunganPenawaran) * 100).toFixed(
              2,
            ),
          )
        : null,
  }));
};

/**
 * Gabungkan 3 sumber di atas jadi satu baris per user (sales counter).
 */
const getOpenPipelinePerUser = async (
  startDate,
  endDate,
  cabang,
  userCreate,
) => {
  const [openPenawaran, openSo, kunjungan] = await Promise.all([
    getOpenPenawaranPerUser(startDate, endDate, cabang, userCreate),
    getOpenSoPerUser(startDate, endDate, cabang, userCreate),
    getKunjunganBreakdown(startDate, endDate, cabang, userCreate),
  ]);

  const map = new Map();

  const upsert = (userCreateKey) => {
    if (!map.has(userCreateKey)) {
      map.set(userCreateKey, {
        userCreate: userCreateKey,
        jmlPenawaranOpen: 0,
        nominalPenawaranOpen: 0,
        rataRataUmurPenawaran: null,
        umurPenawaranTertua: 0,
        jmlSoOpen: 0,
        nominalSoOpen: 0,
        rataRataUmurSo: null,
        umurSoTertua: 0,
        kunjunganPenawaran: 0,
        kunjunganSO: 0,
        kunjunganInvoiceLangsung: 0,
        konversiPenawaranKeSo: null,
      });
    }
    return map.get(userCreateKey);
  };

  openPenawaran.forEach((r) => Object.assign(upsert(r.userCreate), r));
  openSo.forEach((r) => Object.assign(upsert(r.userCreate), r));
  kunjungan.forEach((r) => Object.assign(upsert(r.userCreate), r));

  return Array.from(map.values()).sort(
    (a, b) =>
      b.jmlPenawaranOpen + b.jmlSoOpen - (a.jmlPenawaranOpen + a.jmlSoOpen),
  );
};

const getUserOptions = async () => {
  const query = `
    SELECT DISTINCT user_create AS userCreate
    FROM tpenawaran_hdr
    WHERE user_create IS NOT NULL AND user_create != ''
    ORDER BY user_create
  `;
  const [rows] = await pool.query(query);
  return rows;
};

const getBranchOptions = async (userCabang) => {
  let query = "";
  if (userCabang === "KDC") {
    query =
      'SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode NOT IN ("KBS","KPS","KPR","KON") ORDER BY gdg_kode';
  } else {
    query = `SELECT gdg_kode as kode, gdg_nama as nama FROM tgudang WHERE gdg_kode = '${userCabang}'`;
  }
  const [rows] = await pool.query(query);
  return rows;
};

const getOpenPenawaranDetail = async (
  startDate,
  endDate,
  cabang,
  userCreate,
) => {
  const params = [startDate, endDate];
  const branchFilter = buildBranchFilter(cabang, params, "h.pen_cab");

  let userFilter = "";
  if (userCreate && userCreate !== "ALL") {
    userFilter = "AND h.user_create = ?";
    params.push(userCreate);
  }

  const query = `
    SELECT
      h.pen_nomor AS nomor,
      h.pen_tanggal AS tanggal,
      h.pen_cus_kode AS kdcus,
      c.cus_nama AS namaCustomer,
      c.cus_telp AS telpCustomer,
      h.pen_cab AS cabang,
      g.gdg_nama AS namaCabang,
      DATEDIFF(CURDATE(), h.pen_tanggal) AS umurHari,
      ${PEN_NOMINAL_SUBQUERY.replace(/hh\./g, "h.")} AS nominal
    FROM tpenawaran_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
    LEFT JOIN tgudang g ON g.gdg_kode = h.pen_cab
    LEFT JOIN tso_hdr so ON so.so_pen_nomor = h.pen_nomor AND so.so_aktif = 'Y'
    WHERE h.pen_tanggal BETWEEN ? AND ?
      AND so.so_nomor IS NULL
      AND (h.pen_alasan IS NULL OR h.pen_alasan = '')
      ${branchFilter}
      ${userFilter}
    ORDER BY h.pen_tanggal ASC
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

const getOpenSoDetail = async (startDate, endDate, cabang, userCreate) => {
  const params = [startDate, endDate];
  const branchFilter = buildBranchFilter(cabang, params, "so.so_cab");

  let userFilter = "";
  if (userCreate && userCreate !== "ALL") {
    userFilter = "AND so.user_create = ?";
    params.push(userCreate);
  }

  const query = `
    SELECT
      so.so_nomor AS nomor,
      so.so_tanggal AS tanggal,
      so.so_pen_nomor AS nomorPenawaran,
      so.so_cus_kode AS kdcus,
      c.cus_nama AS namaCustomer,
      c.cus_telp AS telpCustomer,
      so.so_cab AS cabang,
      g.gdg_nama AS namaCabang,
      so.so_dateline AS dateline,
      DATEDIFF(CURDATE(), so.so_tanggal) AS umurHari,
      ${SO_NOMINAL_SUBQUERY.replace(/shh\./g, "so.")} AS nominal
    FROM tso_hdr so
    LEFT JOIN tcustomer c ON c.cus_kode = so.so_cus_kode
    LEFT JOIN tgudang g ON g.gdg_kode = so.so_cab
    LEFT JOIN tinv_hdr inv ON inv.inv_nomor_so = so.so_nomor
    WHERE so.so_tanggal BETWEEN ? AND ?
      AND so.so_aktif = 'Y'
      AND so.so_close = 0
      AND inv.inv_nomor IS NULL
      ${branchFilter}
      ${userFilter}
    ORDER BY so.so_tanggal ASC
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Penawaran WON = sudah ada SO aktif. Tanggal closing = so.so_tanggal.
 * Penawaran LOST = ditutup manual (pen_alasan terisi) tanpa pernah jadi SO.
 *   Tanggal closing = h.date_modified (proxy, karena tidak ada kolom tanggal-close khusus).
 */
const getClosedPenawaranPerUser = async (
  startDate,
  endDate,
  cabang,
  userCreate,
) => {
  const wonParams = [startDate, endDate];
  const wonBranchFilter = buildBranchFilter(cabang, wonParams, "h.pen_cab");
  let wonUserFilter = "";
  if (userCreate && userCreate !== "ALL") {
    wonUserFilter = "AND h.user_create = ?";
    wonParams.push(userCreate);
  }

  const wonQuery = `
    SELECT
      h.user_create AS userCreate,
      COUNT(DISTINCT h.pen_nomor) AS jmlPenawaranWon,
      ROUND(SUM(PEN_NOM.nominal), 2) AS nominalPenawaranWon
    FROM tpenawaran_hdr h
    INNER JOIN tso_hdr so ON so.so_pen_nomor = h.pen_nomor AND so.so_aktif = 'Y'
    LEFT JOIN (
      SELECT hh.pen_nomor, ${PEN_NOMINAL_SUBQUERY} AS nominal
      FROM tpenawaran_hdr hh
    ) PEN_NOM ON PEN_NOM.pen_nomor = h.pen_nomor
    WHERE so.so_tanggal BETWEEN ? AND ?
      ${wonBranchFilter}
      ${wonUserFilter}
    GROUP BY h.user_create
  `;

  const lostParams = [startDate, endDate];
  const lostBranchFilter = buildBranchFilter(cabang, lostParams, "h.pen_cab");
  let lostUserFilter = "";
  if (userCreate && userCreate !== "ALL") {
    lostUserFilter = "AND h.user_create = ?";
    lostParams.push(userCreate);
  }

  const lostQuery = `
    SELECT
      h.user_create AS userCreate,
      COUNT(DISTINCT h.pen_nomor) AS jmlPenawaranLost,
      ROUND(SUM(PEN_NOM.nominal), 2) AS nominalPenawaranLost
    FROM tpenawaran_hdr h
    LEFT JOIN tso_hdr so ON so.so_pen_nomor = h.pen_nomor AND so.so_aktif = 'Y'
    LEFT JOIN (
      SELECT hh.pen_nomor, ${PEN_NOMINAL_SUBQUERY} AS nominal
      FROM tpenawaran_hdr hh
    ) PEN_NOM ON PEN_NOM.pen_nomor = h.pen_nomor
    WHERE so.so_nomor IS NULL
      AND h.pen_alasan IS NOT NULL AND h.pen_alasan != ''
      AND h.date_modified BETWEEN ? AND ?
      ${lostBranchFilter}
      ${lostUserFilter}
    GROUP BY h.user_create
  `;

  const [[wonRows], [lostRows]] = await Promise.all([
    pool.query(wonQuery, wonParams),
    pool.query(lostQuery, lostParams),
  ]);

  return { wonRows, lostRows };
};

/**
 * SO WON = sudah ada Invoice. Tanggal closing = inv.inv_tanggal.
 * SO LOST = so_close = 1 tanpa Invoice. Tanggal closing = so.date_modified (proxy).
 */
const getClosedSoPerUser = async (startDate, endDate, cabang, userCreate) => {
  const wonParams = [startDate, endDate];
  const wonBranchFilter = buildBranchFilter(cabang, wonParams, "so.so_cab");
  let wonUserFilter = "";
  if (userCreate && userCreate !== "ALL") {
    wonUserFilter = "AND so.user_create = ?";
    wonParams.push(userCreate);
  }

  const wonQuery = `
    SELECT
      so.user_create AS userCreate,
      COUNT(DISTINCT so.so_nomor) AS jmlSoWon,
      ROUND(SUM(SO_NOM.nominal), 2) AS nominalSoWon
    FROM tso_hdr so
    INNER JOIN tinv_hdr inv ON inv.inv_nomor_so = so.so_nomor
    LEFT JOIN (
      SELECT shh.so_nomor, ${SO_NOMINAL_SUBQUERY} AS nominal
      FROM tso_hdr shh WHERE shh.so_aktif = 'Y'
    ) SO_NOM ON SO_NOM.so_nomor = so.so_nomor
    WHERE inv.inv_tanggal BETWEEN ? AND ?
      AND so.so_aktif = 'Y'
      ${wonBranchFilter}
      ${wonUserFilter}
    GROUP BY so.user_create
  `;

  const lostParams = [startDate, endDate];
  const lostBranchFilter = buildBranchFilter(cabang, lostParams, "so.so_cab");
  let lostUserFilter = "";
  if (userCreate && userCreate !== "ALL") {
    lostUserFilter = "AND so.user_create = ?";
    lostParams.push(userCreate);
  }

  const lostQuery = `
    SELECT
      so.user_create AS userCreate,
      COUNT(DISTINCT so.so_nomor) AS jmlSoLost,
      ROUND(SUM(SO_NOM.nominal), 2) AS nominalSoLost
    FROM tso_hdr so
    LEFT JOIN tinv_hdr inv ON inv.inv_nomor_so = so.so_nomor
    LEFT JOIN (
      SELECT shh.so_nomor, ${SO_NOMINAL_SUBQUERY} AS nominal
      FROM tso_hdr shh WHERE shh.so_aktif = 'Y'
    ) SO_NOM ON SO_NOM.so_nomor = so.so_nomor
    WHERE inv.inv_nomor IS NULL
      AND so.so_close = 1
      AND so.so_aktif = 'Y'
      AND so.date_modified BETWEEN ? AND ?
      ${lostBranchFilter}
      ${lostUserFilter}
    GROUP BY so.user_create
  `;

  const [[wonRows], [lostRows]] = await Promise.all([
    pool.query(wonQuery, wonParams),
    pool.query(lostQuery, lostParams),
  ]);

  return { wonRows, lostRows };
};

const getClosedPipelinePerUser = async (
  startDate,
  endDate,
  cabang,
  userCreate,
) => {
  const [penClosed, soClosed] = await Promise.all([
    getClosedPenawaranPerUser(startDate, endDate, cabang, userCreate),
    getClosedSoPerUser(startDate, endDate, cabang, userCreate),
  ]);

  const map = new Map();
  const upsert = (userCreateKey) => {
    if (!map.has(userCreateKey)) {
      map.set(userCreateKey, {
        userCreate: userCreateKey,
        jmlPenawaranWon: 0,
        nominalPenawaranWon: 0,
        jmlPenawaranLost: 0,
        nominalPenawaranLost: 0,
        jmlSoWon: 0,
        nominalSoWon: 0,
        jmlSoLost: 0,
        nominalSoLost: 0,
      });
    }
    return map.get(userCreateKey);
  };

  penClosed.wonRows.forEach((r) => Object.assign(upsert(r.userCreate), r));
  penClosed.lostRows.forEach((r) => Object.assign(upsert(r.userCreate), r));
  soClosed.wonRows.forEach((r) => Object.assign(upsert(r.userCreate), r));
  soClosed.lostRows.forEach((r) => Object.assign(upsert(r.userCreate), r));

  return Array.from(map.values()).sort(
    (a, b) => b.jmlPenawaranWon + b.jmlSoWon - (a.jmlPenawaranWon + a.jmlSoWon),
  );
};

const getClosedPenawaranWonDetail = async (
  startDate,
  endDate,
  cabang,
  userCreate,
) => {
  const params = [startDate, endDate];
  const branchFilter = buildBranchFilter(cabang, params, "h.pen_cab");
  let userFilter = "";
  if (userCreate && userCreate !== "ALL") {
    userFilter = "AND h.user_create = ?";
    params.push(userCreate);
  }

  const query = `
    SELECT
      h.pen_nomor AS nomor, h.pen_tanggal AS tanggal,
      h.pen_cus_kode AS kdcus, c.cus_nama AS namaCustomer, c.cus_telp AS telpCustomer,
      h.pen_cab AS cabang, g.gdg_nama AS namaCabang,
      so.so_nomor AS nomorSo, so.so_tanggal AS tanggalClosing,
      ${PEN_NOMINAL_SUBQUERY.replace(/hh\./g, "h.")} AS nominal
    FROM tpenawaran_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
    LEFT JOIN tgudang g ON g.gdg_kode = h.pen_cab
    INNER JOIN tso_hdr so ON so.so_pen_nomor = h.pen_nomor AND so.so_aktif = 'Y'
    WHERE so.so_tanggal BETWEEN ? AND ?
      ${branchFilter}
      ${userFilter}
    ORDER BY so.so_tanggal DESC
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

const getClosedPenawaranLostDetail = async (
  startDate,
  endDate,
  cabang,
  userCreate,
) => {
  const params = [startDate, endDate];
  const branchFilter = buildBranchFilter(cabang, params, "h.pen_cab");
  let userFilter = "";
  if (userCreate && userCreate !== "ALL") {
    userFilter = "AND h.user_create = ?";
    params.push(userCreate);
  }

  const query = `
    SELECT
      h.pen_nomor AS nomor, h.pen_tanggal AS tanggal,
      h.pen_cus_kode AS kdcus, c.cus_nama AS namaCustomer, c.cus_telp AS telpCustomer,
      h.pen_cab AS cabang, g.gdg_nama AS namaCabang,
      h.pen_alasan AS alasan, h.date_modified AS tanggalClosing,
      ${PEN_NOMINAL_SUBQUERY.replace(/hh\./g, "h.")} AS nominal
    FROM tpenawaran_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
    LEFT JOIN tgudang g ON g.gdg_kode = h.pen_cab
    LEFT JOIN tso_hdr so ON so.so_pen_nomor = h.pen_nomor AND so.so_aktif = 'Y'
    WHERE so.so_nomor IS NULL
      AND h.pen_alasan IS NOT NULL AND h.pen_alasan != ''
      AND h.date_modified BETWEEN ? AND ?
      ${branchFilter}
      ${userFilter}
    ORDER BY h.date_modified DESC
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

const getClosedSoWonDetail = async (startDate, endDate, cabang, userCreate) => {
  const params = [startDate, endDate];
  const branchFilter = buildBranchFilter(cabang, params, "so.so_cab");
  let userFilter = "";
  if (userCreate && userCreate !== "ALL") {
    userFilter = "AND so.user_create = ?";
    params.push(userCreate);
  }

  const query = `
    SELECT
      so.so_nomor AS nomor, so.so_tanggal AS tanggal, so.so_pen_nomor AS nomorPenawaran,
      so.so_cus_kode AS kdcus, c.cus_nama AS namaCustomer, c.cus_telp AS telpCustomer,
      so.so_cab AS cabang, g.gdg_nama AS namaCabang,
      inv.inv_nomor AS nomorInvoice, inv.inv_tanggal AS tanggalClosing,
      ${SO_NOMINAL_SUBQUERY.replace(/shh\./g, "so.")} AS nominal
    FROM tso_hdr so
    LEFT JOIN tcustomer c ON c.cus_kode = so.so_cus_kode
    LEFT JOIN tgudang g ON g.gdg_kode = so.so_cab
    INNER JOIN tinv_hdr inv ON inv.inv_nomor_so = so.so_nomor
    WHERE inv.inv_tanggal BETWEEN ? AND ?
      AND so.so_aktif = 'Y'
      ${branchFilter}
      ${userFilter}
    ORDER BY inv.inv_tanggal DESC
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

const getClosedSoLostDetail = async (
  startDate,
  endDate,
  cabang,
  userCreate,
) => {
  const params = [startDate, endDate];
  const branchFilter = buildBranchFilter(cabang, params, "so.so_cab");
  let userFilter = "";
  if (userCreate && userCreate !== "ALL") {
    userFilter = "AND so.user_create = ?";
    params.push(userCreate);
  }

  const query = `
    SELECT
      so.so_nomor AS nomor, so.so_tanggal AS tanggal, so.so_pen_nomor AS nomorPenawaran,
      so.so_cus_kode AS kdcus, c.cus_nama AS namaCustomer, c.cus_telp AS telpCustomer,
      so.so_cab AS cabang, g.gdg_nama AS namaCabang,
      so.so_alasan AS alasan, so.date_modified AS tanggalClosing,
      ${SO_NOMINAL_SUBQUERY.replace(/shh\./g, "so.")} AS nominal
    FROM tso_hdr so
    LEFT JOIN tcustomer c ON c.cus_kode = so.so_cus_kode
    LEFT JOIN tgudang g ON g.gdg_kode = so.so_cab
    LEFT JOIN tinv_hdr inv ON inv.inv_nomor_so = so.so_nomor
    WHERE inv.inv_nomor IS NULL
      AND so.so_close = 1
      AND so.so_aktif = 'Y'
      AND so.date_modified BETWEEN ? AND ?
      ${branchFilter}
      ${userFilter}
    ORDER BY so.date_modified DESC
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

const PENAWARAN_BUCKET_CASE = `
  CASE
    WHEN DATEDIFF(CURDATE(), h.pen_tanggal) < 3 THEN 'lt3'
    WHEN DATEDIFF(CURDATE(), h.pen_tanggal) BETWEEN 3 AND 7 THEN '3to7'
    ELSE 'gt7'
  END
`;

const SO_INTERNAL_BUCKET_CASE = `
  CASE
    WHEN DATEDIFF(CURDATE(), so.so_dateline) <= 3 THEN 'ontrack'
    WHEN DATEDIFF(CURDATE(), so.so_dateline) BETWEEN 4 AND 7 THEN 'warning'
    ELSE 'critical'
  END
`;

const SO_PABRIK_BUCKET_CASE = `
  CASE
    WHEN DATEDIFF(CURDATE(), so.so_dateline) <= 14 THEN 'proses'
    WHEN DATEDIFF(CURDATE(), so.so_dateline) BETWEEN 15 AND 21 THEN 'tunggu'
    ELSE 'telat'
  END
`;

/**
 * Bucket Penawaran open, group by cabang + user_create (SC).
 */
const getPenawaranTreeBuckets = async (
  startDate,
  endDate,
  cabang,
  userCreate,
) => {
  const params = [startDate, endDate];
  const branchFilter = buildBranchFilter(cabang, params, "h.pen_cab");
  let userFilter = "";
  if (userCreate && userCreate !== "ALL") {
    userFilter = "AND h.user_create = ?";
    params.push(userCreate);
  }

  const query = `
    SELECT
      h.pen_cab AS cabang,
      g.gdg_nama AS cabangNama,
      h.user_create AS userCreate,
      ${PENAWARAN_BUCKET_CASE} AS bucket,
      COUNT(DISTINCT h.pen_nomor) AS jumlah,
      ROUND(SUM(PEN_NOM.nominal), 2) AS nominal,
      SUM(DATEDIFF(CURDATE(), h.pen_tanggal)) AS totalHari
    FROM tpenawaran_hdr h
    LEFT JOIN tgudang g ON g.gdg_kode = h.pen_cab
    LEFT JOIN tso_hdr so ON so.so_pen_nomor = h.pen_nomor AND so.so_aktif = 'Y'
    LEFT JOIN (
      SELECT hh.pen_nomor, ${PEN_NOMINAL_SUBQUERY} AS nominal
      FROM tpenawaran_hdr hh
    ) PEN_NOM ON PEN_NOM.pen_nomor = h.pen_nomor
    WHERE h.pen_tanggal BETWEEN ? AND ?
      AND so.so_nomor IS NULL
      AND (h.pen_alasan IS NULL OR h.pen_alasan = '')
      ${branchFilter}
      ${userFilter}
    GROUP BY h.pen_cab, h.user_create, bucket
  `;
  const [rows] = await pool.query(query, params);
  return rows.map((r) => ({
    ...r,
    jumlah: Number(r.jumlah) || 0,
    nominal: Number(r.nominal) || 0,
    totalHari: Number(r.totalHari) || 0,
    kategori: "penawaran",
  }));
};

/**
 * Bucket SO Internal (TIDAK ada match di kencanaprint.tspk.spk_invdc),
 * group by cabang + user_create SO (SC), basis so_dateline.
 */
const getSoInternalTreeBuckets = async (
  startDate,
  endDate,
  cabang,
  userCreate,
) => {
  const params = [startDate, endDate];
  const branchFilter = buildBranchFilter(cabang, params, "so.so_cab");
  let userFilter = "";
  if (userCreate && userCreate !== "ALL") {
    userFilter = "AND so.user_create = ?";
    params.push(userCreate);
  }

  const query = `
    SELECT
      so.so_cab AS cabang,
      g.gdg_nama AS cabangNama,
      so.user_create AS userCreate,
      ${SO_INTERNAL_BUCKET_CASE} AS bucket,
      COUNT(DISTINCT so.so_nomor) AS jumlah,
      ROUND(SUM(SO_NOM.nominal), 2) AS nominal,
      SUM(DATEDIFF(CURDATE(), so.so_dateline)) AS totalHari
    FROM tso_hdr so
    LEFT JOIN tgudang g ON g.gdg_kode = so.so_cab
    LEFT JOIN tinv_hdr inv ON inv.inv_nomor_so = so.so_nomor
    LEFT JOIN (
      SELECT shh.so_nomor, ${SO_NOMINAL_SUBQUERY} AS nominal
      FROM tso_hdr shh WHERE shh.so_aktif = 'Y'
    ) SO_NOM ON SO_NOM.so_nomor = so.so_nomor
    WHERE so.so_tanggal BETWEEN ? AND ?
      AND so.so_aktif = 'Y'
      AND so.so_close = 0
      AND so.so_dateline IS NOT NULL
      AND inv.inv_nomor IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM kencanaprint.tspk spk WHERE spk.spk_invdc = so.so_nomor
      )
      ${branchFilter}
      ${userFilter}
    GROUP BY so.so_cab, so.user_create, bucket
  `;
  const [rows] = await pool.query(query, params);
  return rows.map((r) => ({
    ...r,
    jumlah: Number(r.jumlah) || 0,
    nominal: Number(r.nominal) || 0,
    totalHari: Number(r.totalHari) || 0,
    kategori: "so_internal",
  }));
};

/**
 * Bucket SO Pabrik (ADA match di kencanaprint.tspk.spk_invdc),
 * group by cabang + PIC SPK (tspk.user_create) — BUKAN so.user_create.
 * Filter userCreate TIDAK diterapkan di sini (sesuai keputusan).
 */
const getSoPabrikTreeBuckets = async (startDate, endDate, cabang) => {
  const params = [startDate, endDate];
  const branchFilter = buildBranchFilter(cabang, params, "so.so_cab");

  const query = `
    SELECT
      so.so_cab AS cabang,
      g.gdg_nama AS cabangNama,
      spk.user_create AS userCreate,
      ${SO_PABRIK_BUCKET_CASE} AS bucket,
      COUNT(DISTINCT so.so_nomor) AS jumlah,
      ROUND(SUM(SO_NOM.nominal), 2) AS nominal,
      SUM(DATEDIFF(CURDATE(), so.so_dateline)) AS totalHari
    FROM tso_hdr so
    INNER JOIN kencanaprint.tspk spk ON spk.spk_invdc = so.so_nomor
    LEFT JOIN tgudang g ON g.gdg_kode = so.so_cab
    LEFT JOIN tinv_hdr inv ON inv.inv_nomor_so = so.so_nomor
    LEFT JOIN (
      SELECT shh.so_nomor, ${SO_NOMINAL_SUBQUERY} AS nominal
      FROM tso_hdr shh WHERE shh.so_aktif = 'Y'
    ) SO_NOM ON SO_NOM.so_nomor = so.so_nomor
    WHERE so.so_tanggal BETWEEN ? AND ?
      AND so.so_aktif = 'Y'
      AND so.so_close = 0
      AND so.so_dateline IS NOT NULL
      AND inv.inv_nomor IS NULL
      ${branchFilter}
    GROUP BY so.so_cab, spk.user_create, bucket
  `;
  const [rows] = await pool.query(query, params);
  return rows.map((r) => ({
    ...r,
    jumlah: Number(r.jumlah) || 0,
    nominal: Number(r.nominal) || 0,
    totalHari: Number(r.totalHari) || 0,
    kategori: "so_pabrik",
  }));
};

/**
 * Gabungkan ketiga bucket jadi satu array flat untuk di-nest di frontend.
 */
const getOpenPipelineTree = async (startDate, endDate, cabang, userCreate) => {
  const [penawaran, soInternal, soPabrik] = await Promise.all([
    getPenawaranTreeBuckets(startDate, endDate, cabang, userCreate),
    getSoInternalTreeBuckets(startDate, endDate, cabang, userCreate),
    getSoPabrikTreeBuckets(startDate, endDate, cabang), // tanpa userCreate
  ]);
  return [...penawaran, ...soInternal, ...soPabrik];
};

/**
 * Detail Penawaran per bucket umur (extend dari getOpenPenawaranDetail,
 * tambah filter bucket).
 */
const getOpenPenawaranBucketDetail = async (
  startDate,
  endDate,
  cabang,
  userCreate,
  bucket,
) => {
  const params = [startDate, endDate];
  const branchFilter = buildBranchFilter(cabang, params, "h.pen_cab");
  let userFilter = "";
  if (userCreate && userCreate !== "ALL") {
    userFilter = "AND h.user_create = ?";
    params.push(userCreate);
  }

  const bucketCondition =
    bucket === "lt3"
      ? "DATEDIFF(CURDATE(), h.pen_tanggal) < 3"
      : bucket === "3to7"
        ? "DATEDIFF(CURDATE(), h.pen_tanggal) BETWEEN 3 AND 7"
        : "DATEDIFF(CURDATE(), h.pen_tanggal) > 7";

  const query = `
    SELECT
      h.pen_nomor AS nomor, h.pen_tanggal AS tanggal,
      h.pen_cus_kode AS kdcus, c.cus_nama AS namaCustomer, c.cus_telp AS telpCustomer,
      h.pen_cab AS cabang, g.gdg_nama AS namaCabang,
      DATEDIFF(CURDATE(), h.pen_tanggal) AS umurHari,
      ${PEN_NOMINAL_SUBQUERY.replace(/hh\./g, "h.")} AS nominal
    FROM tpenawaran_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.pen_cus_kode
    LEFT JOIN tgudang g ON g.gdg_kode = h.pen_cab
    LEFT JOIN tso_hdr so ON so.so_pen_nomor = h.pen_nomor AND so.so_aktif = 'Y'
    WHERE h.pen_tanggal BETWEEN ? AND ?
      AND so.so_nomor IS NULL
      AND (h.pen_alasan IS NULL OR h.pen_alasan = '')
      AND ${bucketCondition}
      ${branchFilter}
      ${userFilter}
    ORDER BY h.pen_tanggal ASC
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Detail SO Internal per bucket overdue (basis so_dateline).
 */
const getSoInternalBucketDetail = async (
  startDate,
  endDate,
  cabang,
  userCreate,
  bucket,
) => {
  const params = [startDate, endDate];
  const branchFilter = buildBranchFilter(cabang, params, "so.so_cab");
  let userFilter = "";
  if (userCreate && userCreate !== "ALL") {
    userFilter = "AND so.user_create = ?";
    params.push(userCreate);
  }

  const bucketCondition =
    bucket === "ontrack"
      ? "DATEDIFF(CURDATE(), so.so_dateline) <= 3"
      : bucket === "warning"
        ? "DATEDIFF(CURDATE(), so.so_dateline) BETWEEN 4 AND 7"
        : "DATEDIFF(CURDATE(), so.so_dateline) > 7";

  const query = `
    SELECT
      so.so_nomor AS nomor, so.so_tanggal AS tanggal, so.so_pen_nomor AS nomorPenawaran,
      so.so_cus_kode AS kdcus, c.cus_nama AS namaCustomer, c.cus_telp AS telpCustomer,
      so.so_cab AS cabang, g.gdg_nama AS namaCabang,
      so.so_dateline AS dateline,
      DATEDIFF(CURDATE(), so.so_dateline) AS overdueHari,
      ${SO_NOMINAL_SUBQUERY.replace(/shh\./g, "so.")} AS nominal
    FROM tso_hdr so
    LEFT JOIN tcustomer c ON c.cus_kode = so.so_cus_kode
    LEFT JOIN tgudang g ON g.gdg_kode = so.so_cab
    LEFT JOIN tinv_hdr inv ON inv.inv_nomor_so = so.so_nomor
    WHERE so.so_tanggal BETWEEN ? AND ?
      AND so.so_aktif = 'Y'
      AND so.so_close = 0
      AND so.so_dateline IS NOT NULL
      AND inv.inv_nomor IS NULL
      AND NOT EXISTS (SELECT 1 FROM kencanaprint.tspk spk WHERE spk.spk_invdc = so.so_nomor)
      AND ${bucketCondition}
      ${branchFilter}
      ${userFilter}
    ORDER BY so.so_dateline ASC
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Detail SO Pabrik per bucket overdue, filter by PIC SPK (bukan SC),
 * plus tampilkan nomor SPK.
 */
const getSoPabrikBucketDetail = async (
  startDate,
  endDate,
  cabang,
  pic,
  bucket,
) => {
  const params = [startDate, endDate];
  const branchFilter = buildBranchFilter(cabang, params, "so.so_cab");
  let picFilter = "";
  if (pic && pic !== "ALL") {
    picFilter = "AND spk.user_create = ?";
    params.push(pic);
  }

  const bucketCondition =
    bucket === "proses"
      ? "DATEDIFF(CURDATE(), so.so_dateline) <= 14"
      : bucket === "tunggu"
        ? "DATEDIFF(CURDATE(), so.so_dateline) BETWEEN 15 AND 21"
        : "DATEDIFF(CURDATE(), so.so_dateline) > 21";

  const query = `
    SELECT
      so.so_nomor AS nomor, so.so_tanggal AS tanggal, so.so_pen_nomor AS nomorPenawaran,
      spk.spk_nomor AS nomorSpk, spk.user_create AS picSpk,
      so.so_cus_kode AS kdcus, c.cus_nama AS namaCustomer, c.cus_telp AS telpCustomer,
      so.so_cab AS cabang, g.gdg_nama AS namaCabang,
      so.so_dateline AS dateline,
      DATEDIFF(CURDATE(), so.so_dateline) AS overdueHari,
      ${SO_NOMINAL_SUBQUERY.replace(/shh\./g, "so.")} AS nominal
    FROM tso_hdr so
    INNER JOIN kencanaprint.tspk spk ON spk.spk_invdc = so.so_nomor
    LEFT JOIN tcustomer c ON c.cus_kode = so.so_cus_kode
    LEFT JOIN tgudang g ON g.gdg_kode = so.so_cab
    LEFT JOIN tinv_hdr inv ON inv.inv_nomor_so = so.so_nomor
    WHERE so.so_tanggal BETWEEN ? AND ?
      AND so.so_aktif = 'Y'
      AND so.so_close = 0
      AND so.so_dateline IS NOT NULL
      AND inv.inv_nomor IS NULL
      AND ${bucketCondition}
      ${branchFilter}
      ${picFilter}
    ORDER BY so.so_dateline ASC
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * SO Internal — semua bucket (untuk export), basis sama seperti getSoInternalBucketDetail
 * tapi tanpa filter bucket.
 */
const getSoInternalAllDetail = async (
  startDate,
  endDate,
  cabang,
  userCreate,
) => {
  const params = [startDate, endDate];
  const branchFilter = buildBranchFilter(cabang, params, "so.so_cab");
  let userFilter = "";
  if (userCreate && userCreate !== "ALL") {
    userFilter = "AND so.user_create = ?";
    params.push(userCreate);
  }

  const query = `
    SELECT
      so.so_nomor AS nomor, so.so_tanggal AS tanggal, so.so_pen_nomor AS nomorPenawaran,
      so.user_create AS userCreate,
      so.so_cus_kode AS kdcus, c.cus_nama AS namaCustomer, c.cus_telp AS telpCustomer,
      so.so_cab AS cabang, g.gdg_nama AS namaCabang,
      so.so_dateline AS dateline,
      DATEDIFF(CURDATE(), so.so_dateline) AS overdueHari,
      ${SO_NOMINAL_SUBQUERY.replace(/shh\./g, "so.")} AS nominal
    FROM tso_hdr so
    LEFT JOIN tcustomer c ON c.cus_kode = so.so_cus_kode
    LEFT JOIN tgudang g ON g.gdg_kode = so.so_cab
    LEFT JOIN tinv_hdr inv ON inv.inv_nomor_so = so.so_nomor
    WHERE so.so_tanggal BETWEEN ? AND ?
      AND so.so_aktif = 'Y'
      AND so.so_close = 0
      AND so.so_dateline IS NOT NULL
      AND inv.inv_nomor IS NULL
      AND NOT EXISTS (SELECT 1 FROM kencanaprint.tspk spk WHERE spk.spk_invdc = so.so_nomor)
      ${branchFilter}
      ${userFilter}
    ORDER BY so.so_dateline ASC
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * SO Pabrik — semua bucket (untuk export), tanpa filter userCreate
 * (konsisten dengan keputusan: SO Pabrik nggak kena filter dropdown Sales).
 */
const getSoPabrikAllDetail = async (startDate, endDate, cabang) => {
  const params = [startDate, endDate];
  const branchFilter = buildBranchFilter(cabang, params, "so.so_cab");

  const query = `
    SELECT
      so.so_nomor AS nomor, so.so_tanggal AS tanggal, so.so_pen_nomor AS nomorPenawaran,
      spk.spk_nomor AS nomorSpk, spk.user_create AS picSpk,
      so.so_cus_kode AS kdcus, c.cus_nama AS namaCustomer, c.cus_telp AS telpCustomer,
      so.so_cab AS cabang, g.gdg_nama AS namaCabang,
      so.so_dateline AS dateline,
      DATEDIFF(CURDATE(), so.so_dateline) AS overdueHari,
      ${SO_NOMINAL_SUBQUERY.replace(/shh\./g, "so.")} AS nominal
    FROM tso_hdr so
    INNER JOIN kencanaprint.tspk spk ON spk.spk_invdc = so.so_nomor
    LEFT JOIN tcustomer c ON c.cus_kode = so.so_cus_kode
    LEFT JOIN tgudang g ON g.gdg_kode = so.so_cab
    LEFT JOIN tinv_hdr inv ON inv.inv_nomor_so = so.so_nomor
    WHERE so.so_tanggal BETWEEN ? AND ?
      AND so.so_aktif = 'Y'
      AND so.so_close = 0
      AND so.so_dateline IS NOT NULL
      AND inv.inv_nomor IS NULL
      ${branchFilter}
    ORDER BY so.so_dateline ASC
  `;
  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getOpenPipelinePerUser,
  getOpenPenawaranDetail,
  getOpenSoDetail,
  getClosedPipelinePerUser,
  getClosedPenawaranWonDetail,
  getClosedPenawaranLostDetail,
  getClosedSoWonDetail,
  getClosedSoLostDetail,
  getUserOptions,
  getBranchOptions,
  getOpenPipelineTree,
  getOpenPenawaranBucketDetail,
  getSoInternalBucketDetail,
  getSoPabrikBucketDetail,
  getSoInternalAllDetail,
  getSoPabrikAllDetail,
};
