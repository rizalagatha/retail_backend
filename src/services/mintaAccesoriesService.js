const pool = require("../config/database");
const { format } = require("date-fns");

// --- HELPER FUNCTION ---
const toSqlDate = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : format(d, "yyyy-MM-dd");
};

// --- GENERATE NOMOR APVS (Sesuai Syarat Produksi) ---
const generateNomorAPVS = async (conn) => {
  const yy = new Date().getFullYear().toString().slice(-2);
  const prefix = `APVS${yy}`;

  const query = `SELECT IFNULL(MAX(CAST(RIGHT(red2_apv, 5) AS UNSIGNED)), 0) AS last_num FROM kencanaprint.tgarmenrealisasi_dtl2 WHERE LEFT(red2_apv, 6) = ?`;
  const [rows] = await conn.query(query, [prefix]);

  const nextNum = parseInt(rows[0].last_num, 10) + 1;
  return `${prefix}${String(nextNum).padStart(5, "0")}`;
};

// --- GET ALL (BROWSE) ---
const getAll = async (filters, user) => {
  const { startDate, endDate, keyword } = filters;
  const params = [startDate, endDate];

  let searchFilter = "";
  if (keyword) {
    searchFilter = ` AND (h.min_nomor LIKE ? OR h.min_ket LIKE ?)`;
    const searchPattern = `%${keyword}%`;
    params.push(searchPattern, searchPattern);
  }

  const query = `
    SELECT x.*, v.divisi AS Divisi FROM (
      SELECT 
        h.min_jenis AS Jenis, h.min_nomor AS Nomor, h.min_tanggal AS Tanggal, 
        DATE_FORMAT(h.date_create,"%H:%i:%s") AS Jam, h.min_cab AS Cab, 
        IF(h.min_gp="", p.pab_nama, RIGHT(g.gdgp_nama, LENGTH(g.gdgp_nama)-6)) AS GdgPeminta,
        IFNULL(s.spk_divisi, m.mspk_divisi) AS kddiv,
        h.min_spk_nomor AS SPK, IFNULL(s.spk_nama, m.Mspk_nama) AS NamaSpk, 
        IFNULL(s.spk_jumlah, 0) AS JmlSpk, h.min_ket AS Keterangan, 
        h.min_bagian AS Bagian, h.user_create AS Usr,
        IF(h.min_close=0, "OPEN", IF(h.min_close=1, "CLOSE", IF(h.min_close=9, "DICLOSE", "PROSES"))) AS Status,
        h.min_alasanclose AS AlasanClose,
        IFNULL((SELECT COUNT(*) FROM kencanaprint.tgarmenrealisasi_hdr q WHERE q.re_minta=h.min_nomor),0) AS totr,
        IFNULL((SELECT COUNT(*) FROM kencanaprint.tgarmenrealisasi_hdr q WHERE q.re_minta=h.min_nomor AND q.re_apv IS NOT NULL),0) AS tota,
        IFNULL((
          SELECT IFNULL(IF(pin_acc="" AND pin_dipakai="","WAIT",
                 IF(pin_acc="Y" AND pin_dipakai="","ACC",
                 IF(pin_acc="Y" AND pin_dipakai="Y","",
                 IF(pin_acc="N","TOLAK","")))),"")
          FROM kencanaprint.tspk_pin5 WHERE pin_trs="PERMINTAAN GARMEN" AND pin_nomor=h.min_nomor ORDER BY pin_urut DESC LIMIT 1
        ),"") AS Ngedit
      FROM kencanaprint.tgarmenminta_hdr h
      LEFT JOIN kencanaprint.tgudangproduksi g ON g.gdgp_kode = h.min_gp
      LEFT JOIN kencanaprint.tspk s ON s.spk_nomor = h.min_spk_nomor
      LEFT JOIN kencanaprint.tmemospk m ON m.mspk_nomor = h.min_spk_nomor
      LEFT JOIN kencanaprint.tpabrik p ON p.pab_kode = h.min_cab
      WHERE h.min_tanggal >= ? AND h.min_tanggal <= ? 
        AND h.min_jenis IN ('OBAT', 'ACCESORIES')
        AND h.min_cab = 'P03'
        ${searchFilter}
    ) x 
    LEFT JOIN kencanaprint.tdivisi v ON v.kode = x.kddiv
    ORDER BY x.Nomor DESC
  `;

  const [rows] = await pool.query(query, params);
  return rows.map((row) => ({
    ...row,
    Approve: row.totr === 0 ? "" : row.tota < row.totr ? "N" : "Y",
  }));
};

// --- GET DETAILS (EXPAND ROW) ---
const getDetails = async (nomor) => {
  // 1. Realisasi Header
  const realisasiQuery = `
    SELECT 
      h.re_minta AS NomorMinta, h.re_nomor AS NoRealisasi, h.re_tanggal AS TglRealisasi, 
      IF(h.re_apv IS NULL, "", DATE_FORMAT(h.re_apv, "%d-%m-%Y %H:%i:%s")) AS Approve, 
      SUM(d.red_jumlah) AS Jumlah, h.re_keterangan AS Keterangan
    FROM kencanaprint.tgarmenrealisasi_hdr h
    INNER JOIN kencanaprint.tgarmenrealisasi_dtl d ON d.red_nomor = h.re_nomor
    WHERE h.re_minta = ?
    GROUP BY h.re_nomor
    ORDER BY h.re_nomor ASC
  `;
  const [realisasiRows] = await pool.query(realisasiQuery, [nomor]);

  // 2. Detail Barang Permintaan — join ke taccesories, bukan tgarmen_brg
  const itemsQuery = `
    SELECT 
      d.mind_brg_kode AS Kode,
      IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama," - ",b.brg_note)) AS Nama,
      b.brg_satuan    AS Satuan,
      b.brg_note      AS Note,
      d.mind_jumlah   AS Jumlah,
      d.mind_ket      AS Keterangan,
      IFNULL((
        SELECT SUM(i.red_jumlah) 
        FROM kencanaprint.tgarmenrealisasi_dtl i 
        INNER JOIN kencanaprint.tgarmenrealisasi_hdr j ON j.re_nomor = i.red_nomor 
        WHERE j.re_minta = d.mind_nomor AND i.red_brg_kode = d.mind_brg_kode
      ), 0) AS Realisasi
    FROM kencanaprint.tgarmenminta_dtl d
    LEFT JOIN kencanaprint.tgarmen_brg b ON b.brg_kode = d.mind_brg_kode
    WHERE d.mind_nomor = ?
    ORDER BY d.mind_urut ASC
  `;
  const [itemsRows] = await pool.query(itemsQuery, [nomor]);

  // 3. Rincian Item Realisasi — join ke taccesories juga
  const realisasiDetailsQuery = `
    SELECT 
      h.re_minta     AS NomorMinta,
      d.red_nomor    AS NomorRealisasi,
      d.red_brg_kode AS Kode,
      IF(b.brg_note="", b.brg_nama, CONCAT(b.brg_nama," - ",b.brg_note)) AS Nama,
      b.brg_satuan   AS Satuan,
      d.red_jumlah   AS Jumlah
    FROM kencanaprint.tgarmenrealisasi_dtl d
    INNER JOIN kencanaprint.tgarmenrealisasi_hdr h ON h.re_nomor = d.red_nomor
    LEFT JOIN kencanaprint.tgarmen_brg b ON b.brg_kode = d.red_brg_kode
    WHERE h.re_minta = ?
    ORDER BY d.red_nomor ASC, d.red_brg_kode ASC
  `;
  const [realisasiDetailsRows] = await pool.query(realisasiDetailsQuery, [
    nomor,
  ]);

  const formattedRealisasi = realisasiRows.map((r) => ({
    ...r,
    TglRealisasi: r.TglRealisasi
      ? format(new Date(r.TglRealisasi), "dd/MM/yyyy")
      : "",
  }));

  return {
    realisasi: formattedRealisasi,
    items: itemsRows,
    realisasiDetails: realisasiDetailsRows,
  };
};

// --- DELETE ---
const deletePermintaan = async (nomor, userCabang) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Cek Status Eksistensi & Tutup Buku
    const [rows] = await connection.query(
      `SELECT min_cab, min_tanggal, IF(min_close=0, "OPEN", IF(min_close=1, "CLOSE", IF(min_close=9, "DICLOSE", "PROSES"))) AS sts FROM kencanaprint.tgarmenminta_hdr WHERE min_nomor = ?`,
      [nomor],
    );
    if (rows.length === 0) throw new Error("Data tidak ditemukan.");

    const data = rows[0];

    // Validasi Terkunci Parameter Cabang P03
    if (data.min_cab !== "P03") {
      throw new Error("Bukan hak akses wilayah cabang P03.");
    }

    if (data.sts !== "OPEN") {
      throw new Error(`Sudah ${data.sts}. Tidak bisa dihapus.`);
    }

    // Validasi Tutup Buku Langsung ke Database Produksi
    const [closingRow] = await connection.query(
      `SELECT IFNULL(MAX(zdt_close), '2000-01-01') AS zdtClose FROM kencanaprint.tsetup_tutup_buku LIMIT 1`,
    );
    const tglTrs = new Date(data.min_tanggal);
    const zdtClose = new Date(closingRow[0].zdtClose);
    if (tglTrs <= zdtClose) {
      throw new Error(
        "Transaksi tsb sudah close (Tutup Buku). Tidak bisa dihapus.",
      );
    }

    // 2. Eksekusi Hapus Data
    await connection.query(
      `DELETE FROM kencanaprint.tgarmenminta_hdr WHERE min_nomor = ?`,
      [nomor],
    );
    await connection.query(
      `DELETE FROM kencanaprint.tgarmenminta_dtl WHERE mind_nomor = ?`,
      [nomor],
    );

    await connection.commit();
    return { message: "Data permintaan berhasil dihapus." };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// --- CLOSE MANUAL ---
const closeManual = async (nomor, alasan, user) => {
  const [rows] = await pool.query(
    `SELECT min_cab, IF(min_close=0, "OPEN", IF(min_close=1, "CLOSE", IF(min_close=9, "DICLOSE", "PROSES"))) AS sts FROM kencanaprint.tgarmenminta_hdr WHERE min_nomor = ?`,
    [nomor],
  );
  if (rows.length === 0) throw new Error("Data tidak ditemukan.");

  const data = rows[0];

  if (data.min_cab !== "P03") {
    throw new Error("Bukan hak akses wilayah cabang P03.");
  }

  if (data.sts === "CLOSE" || data.sts === "DICLOSE") {
    throw new Error(`Transaksi sudah berstatus ${data.sts}.`);
  }

  await pool.query(
    `UPDATE kencanaprint.tgarmenminta_hdr SET min_close=9, min_alasanclose=? WHERE min_nomor=?`,
    [alasan, nomor],
  );
  return { message: "Permintaan berhasil di-close manual." };
};

// --- CHECK UNAPPROVED REALISASI (Mencegah Form Baru Tertahan) ---
const checkUnapprovedRealisasi = async (userKode, cabangLogin) => {
  // Sesuai Aturan Baru Produksi: Cabang P03 mendapat Hak Bypass aturan blokir
  if (cabangLogin === "P03") {
    return false; // Boleh langsung buka form input baru
  }

  const query = `
    SELECT IFNULL(COUNT(*), 0) AS blmApv
    FROM kencanaprint.tgarmenrealisasi_hdr h
    INNER JOIN kencanaprint.tgarmenminta_hdr a ON a.min_nomor = h.re_minta AND a.user_create = ?
    WHERE h.re_minta LIKE 'MIA%' AND h.re_apv IS NULL AND h.re_tanggal < DATE_ADD(CURDATE(), INTERVAL -1 DAY)
  `;
  const [rows] = await pool.query(query, [userKode]);
  return rows[0].blmApv > 0;
};

// --- APPROVE REALISASI ---
const approveRealisasi = async (noRealisasi, userKode, userCabang) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const qCek = `
      SELECT h.re_apv, h.re_tanggal, m.min_jenis
      FROM kencanaprint.tgarmenrealisasi_hdr h
      INNER JOIN kencanaprint.tgarmenminta_hdr m ON m.min_nomor = h.re_minta
      WHERE h.re_nomor = ?
    `;
    const [cekRows] = await conn.query(qCek, [noRealisasi]);
    if (cekRows.length === 0)
      throw new Error("Data realisasi tidak ditemukan.");

    const data = cekRows[0];

    const sudahApprove =
      data.re_apv !== null &&
      data.re_apv !== "0000-00-00" &&
      data.re_apv !== "";
    if (sudahApprove)
      throw new Error("Realisasi ini sudah diapprove sebelumnya.");

    // Update approve
    const waktuApprove = format(new Date(), "yyyy-MM-dd HH:mm:ss");
    await conn.query(
      `UPDATE kencanaprint.tgarmenrealisasi_hdr SET re_apv = ? WHERE re_nomor = ?`,
      [waktuApprove, noRealisasi],
    );

    // Khusus SPAREPART
    if (data.min_jenis === "SPAREPART") {
      const capv = await generateNomorAPVS(conn);
      await conn.query(
        `
        INSERT INTO kencanaprint.tgarmenrealisasi_dtl2
          (red2_nomor, red2_apv, red2_cab, red2_tanggal, red2_brg_kode, red2_jumlah)
        SELECT red_nomor, ?, ?, CURDATE(), red_brg_kode, red_jumlah
        FROM kencanaprint.tgarmenrealisasi_dtl
        WHERE red_nomor = ?
      `,
        [capv, userCabang, noRealisasi],
      );
    }

    // Insert stok retail — ACCESORIES dan OBAT
    if (["ACCESORIES", "OBAT"].includes(data.min_jenis)) {
      const [detailRows] = await conn.query(
        `
        SELECT red_brg_kode AS brg_kode, red_jumlah AS jumlah
        FROM kencanaprint.tgarmenrealisasi_dtl
        WHERE red_nomor = ?
      `,
        [noRealisasi],
      );

      if (!detailRows.length) throw new Error("Detail item realisasi kosong.");

      const tglStok = data.re_tanggal
        ? format(new Date(data.re_tanggal), "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd");

      for (const item of detailRows) {
        await conn.query(
          `
          INSERT INTO tmasterstok_bahan
            (mst_noreferensi, mst_brg_kode, mst_tanggal,
             mst_stok_in, mst_stok_out, mst_cab, mst_jenis,
             mst_ket, mst_user, mst_tgl_input)
          VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            mst_stok_in = mst_stok_in + VALUES(mst_stok_in)
        `,
          [
            noRealisasi,
            item.brg_kode,
            tglStok,
            item.jumlah,
            userCabang, // cabang user login
            data.min_jenis,
            `Realisasi ${noRealisasi}`,
            userKode || "SYSTEM",
          ],
        );
      }
    }

    await conn.commit();
    return { success: true, message: `Approve berhasil.` };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};
module.exports = {
  getAll,
  getDetails,
  deletePermintaan,
  closeManual,
  checkUnapprovedRealisasi,
  approveRealisasi,
};
