const pool = require("../config/database");

const ke3 = (n) => Math.round(Number(n || 0) * 1000) / 1000;
const kunciBaris = (r) => `${r.packing}|${r.spk}|${r.kode}|${r.ukuran}`;
const kunciItem = (r) => `${r.spk}|${r.kode}|${r.ukuran}`;

// Asal baris STBJ dibaca dari SO milik SPK-nya:
// RETAIL = so_invdc terisi (3 huruf pertama = cabang, isinya biasanya nomor pengajuan harga).
// DC     = so_invdc kosong, atau SPK tanpa SO.
const sqlAsal = (kolomSpk) => `IF(EXISTS (
    SELECT 1
    FROM kencanaprint.tspk sp
    JOIN kencanaprint.tsalesorder so ON so.so_nomor = sp.spk_so_ref AND so.so_aktif = 'Y'
    WHERE sp.spk_nomor = ${kolomSpk} AND TRIM(IFNULL(so.so_invdc, '')) <> ''
  ), 'RETAIL', 'DC')`;

// Posisi penerimaan per baris packing: qty STBJ, sudah diterima, sisa.
// db = pool atau connection (di dalam transaksi).
// Penerimaan lama (tsd_packing = '') dibagikan ke packing berurutan sampai habis.
const getPosisiPenerimaan = async (db, nomorStbj) => {
  const [baris] = await db.query(
    `SELECT e.tsd_packing AS packing, e.tsd_spk_nomor AS spk, e.tsd_kode AS kode,
            e.tsd_ukuran AS ukuran, SUM(e.tsd_jumlah) AS jumlah,
            MAX(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna))) AS nama
       FROM tdc_stbj e
       LEFT JOIN tbarangdc a ON a.brg_kode = e.tsd_kode
      WHERE e.tsd_nomor = ?
      GROUP BY e.tsd_packing, e.tsd_spk_nomor, e.tsd_kode, e.tsd_ukuran
      ORDER BY e.tsd_packing, e.tsd_spk_nomor, e.tsd_kode, e.tsd_ukuran`,
    [nomorStbj],
  );

  const [diterimaRows] = await db.query(
    `SELECT d.tsd_packing AS packing, d.tsd_spk_nomor AS spk, d.tsd_kode AS kode,
            d.tsd_ukuran AS ukuran, SUM(d.tsd_jumlah) AS diterima
       FROM tdc_stbj_hdr ts
       JOIN tdc_stbj_dtl d ON d.tsd_nomor = ts.ts_nomor
      WHERE ts.ts_stbj = ?
      GROUP BY d.tsd_packing, d.tsd_spk_nomor, d.tsd_kode, d.tsd_ukuran`,
    [nomorStbj],
  );

  const perPacking = new Map();
  const lama = new Map();
  for (const r of diterimaRows) {
    if (r.packing === "") lama.set(kunciItem(r), ke3(r.diterima));
    else perPacking.set(kunciBaris(r), ke3(r.diterima));
  }

  return baris.map((b) => {
    const jumlah = ke3(b.jumlah);
    let diterima = Math.min(perPacking.get(kunciBaris(b)) || 0, jumlah);
    const sisaLama = lama.get(kunciItem(b)) || 0;
    if (sisaLama > 0 && diterima < jumlah) {
      const pakai = Math.min(sisaLama, jumlah - diterima);
      diterima = ke3(diterima + pakai);
      lama.set(kunciItem(b), ke3(sisaLama - pakai));
    }
    return { ...b, jumlah, diterima, sisa: ke3(jumlah - diterima) };
  });
};

const ringkasPosisi = (posisi) => {
  const totalQty = ke3(posisi.reduce((s, r) => s + r.jumlah, 0));
  const diterima = ke3(posisi.reduce((s, r) => s + r.diterima, 0));
  const kekurangan = ke3(Math.max(totalQty - diterima, 0));
  const persen =
    totalQty > 0
      ? Math.min(Math.round((diterima / totalQty) * 1000) / 10, 100)
      : 0;
  const statusTerima =
    diterima <= 0 ? "BELUM" : kekurangan <= 0 ? "SEMUA" : "SEBAGIAN";
  return { totalQty, diterima, kekurangan, persen, statusTerima };
};

const getList = async (filters) => {
  const { startDate, endDate, gudang, status, tab } = filters;
  const asal = tab === "RETAIL" || tab === "DC" ? tab : ""; // "" = Gabungan
  const adaStatus = ["BELUM", "SEBAGIAN", "SEMUA"].includes(status);

  // Hanya baris/penerimaan yang berasal dari tab terpilih
  const andAsal = (kolomSpk) =>
    asal ? `AND ${sqlAsal(kolomSpk)} = '${asal}'` : "";
  const andTerimaAsal = asal
    ? `AND EXISTS (
         SELECT 1 FROM tdc_stbj_dtl dd
         WHERE dd.tsd_nomor = ts.ts_nomor AND ${sqlAsal("dd.tsd_spk_nomor")} = '${asal}'
       )`
    : "";

  const query = `
    SELECT x.*,
      GREATEST(x.totalQty - x.diterima, 0) AS kekurangan,
      IF(x.totalQty > 0, LEAST(x.diterima / x.totalQty * 100, 100), 0) AS persen,
      CASE
        WHEN x.diterima <= 0 THEN 'BELUM'
        WHEN x.diterima >= x.totalQty THEN 'SEMUA'
        ELSE 'SEBAGIAN'
      END AS statusTerima
    FROM (
      SELECT
        h.stbj_nomor AS nomor,
        h.stbj_tanggal AS tanggal,
        h.stbj_keterangan AS keterangan,
        g.gdg_nama AS asalGudang,
        IFNULL((SELECT GROUP_CONCAT(ts.ts_nomor ORDER BY ts.ts_nomor SEPARATOR ', ')
                FROM tdc_stbj_hdr ts
                WHERE ts.ts_stbj = h.stbj_nomor ${andTerimaAsal}), '') AS nomorTerima,
        (SELECT COUNT(*) FROM tdc_stbj_hdr ts
          WHERE ts.ts_stbj = h.stbj_nomor ${andTerimaAsal}) AS jumlahPenerimaan,
        (SELECT MAX(ts.ts_tanggal) FROM tdc_stbj_hdr ts
          WHERE ts.ts_stbj = h.stbj_nomor ${andTerimaAsal}) AS tglTerima,
        IFNULL(tl.tl_nomor, '') AS nomorTolak,
        tl.tl_tanggal AS tglTolak,
        h.user_create AS userCreate,
        IFNULL((SELECT MAX(ts.ts_closing) FROM tdc_stbj_hdr ts
                WHERE ts.ts_stbj = h.stbj_nomor ${andTerimaAsal}), 'N') AS closing,
        CAST(IFNULL((SELECT SUM(e.tsd_jumlah) FROM tdc_stbj e
                     WHERE e.tsd_nomor = h.stbj_nomor ${andAsal("e.tsd_spk_nomor")}), 0) AS SIGNED) AS totalQty,
        CAST(IFNULL((SELECT SUM(d.tsd_jumlah)
                     FROM tdc_stbj_hdr ts
                     JOIN tdc_stbj_dtl d ON d.tsd_nomor = ts.ts_nomor
                     WHERE ts.ts_stbj = h.stbj_nomor ${andAsal("d.tsd_spk_nomor")}), 0) AS SIGNED) AS diterima
      FROM kencanaprint.tstbj_hdr h
      LEFT JOIN kencanaprint.tgudang g ON g.gdg_kode = h.stbj_gdg_kode
      LEFT JOIN tdc_stbjtolak tl ON tl.tl_stbj = h.stbj_nomor
      WHERE h.stbj_tanggal BETWEEN ? AND ?
        AND h.stbj_gdg_kode = ?
    ) x
    ${asal ? "WHERE x.totalQty > 0" : ""}
    ${adaStatus ? "HAVING statusTerima = ?" : ""}
    ORDER BY (statusTerima = 'SEMUA'), x.tanggal DESC, x.nomor DESC
  `;
  const params = [startDate, endDate, gudang];
  if (adaStatus) params.push(status);
  const [rows] = await pool.query(query, params);
  return rows;
};

const getDetails = async (nomor) => {
  const posisi = await getPosisiPenerimaan(pool, nomor);
  if (posisi.length === 0) return [];

  // Asal dan gudang (cabang dari 3 huruf pertama so_invdc) per SPK
  const spkList = [...new Set(posisi.map((r) => r.spk))];
  const [asalRows] = await pool.query(
    `SELECT s.spk_nomor AS spk,
            COALESCE(g.gdg_nama, NULLIF(LEFT(TRIM(so.so_invdc), 3), '')) AS gudang,
            IF(TRIM(IFNULL(so.so_invdc, '')) <> '', 'RETAIL', 'DC') AS asal
       FROM kencanaprint.tspk s
       JOIN kencanaprint.tsalesorder so ON so.so_nomor = s.spk_so_ref AND so.so_aktif = 'Y'
       LEFT JOIN tgudang g ON g.gdg_kode = LEFT(TRIM(so.so_invdc), 3)
      WHERE s.spk_nomor IN (?)`,
    [spkList],
  );
  const asalPerSpk = new Map(asalRows.map((r) => [r.spk, r]));

  // Nomor dan tanggal penerimaan per packing
  const [terimaRows] = await pool.query(
    `SELECT d.tsd_packing AS packing,
            GROUP_CONCAT(DISTINCT ts.ts_nomor ORDER BY ts.ts_nomor SEPARATOR ', ') AS nomorTerima,
            MAX(ts.ts_tanggal) AS tglTerima
       FROM tdc_stbj_hdr ts
       JOIN tdc_stbj_dtl d ON d.tsd_nomor = ts.ts_nomor
      WHERE ts.ts_stbj = ?
      GROUP BY d.tsd_packing`,
    [nomor],
  );
  const terimaPerPacking = new Map(terimaRows.map((r) => [r.packing, r]));

  return posisi.map((r) => {
    // Penerimaan lama tidak punya packing: dipakai untuk baris yang sudah terisi
    const info =
      terimaPerPacking.get(r.packing) ??
      (r.diterima > 0 ? terimaPerPacking.get("") : undefined);
    return {
      nomor,
      packing: r.packing,
      spk: r.spk,
      gudang: asalPerSpk.get(r.spk)?.gudang ?? null,
      asal: asalPerSpk.get(r.spk)?.asal ?? "DC",
      kode: r.kode,
      nama: r.nama,
      ukuran: r.ukuran,
      jumlah: r.jumlah,
      diterima: r.diterima,
      selisih: ke3(r.diterima - r.jumlah), // negatif = kurang, sesuai mockup
      status: r.sisa <= 0 ? "DITERIMA" : r.diterima > 0 ? "SEBAGIAN" : "BELUM",
      nomorTerima: info?.nomorTerima ?? "",
      tglTerima: info?.tglTerima ?? null,
    };
  });
};

const cancelReceipt = async (nomorKirim, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Ambil data relevan dari DUA tabel
    const [rows] = await connection.query(
      `SELECT 
        h.stbj_nomor,
        ts.ts_nomor, 
        ts.ts_closing
      FROM kencanaprint.tstbj_hdr h
      LEFT JOIN tdc_stbj_hdr ts ON h.stbj_nomor = ts.ts_stbj
      WHERE h.stbj_nomor = ?`,
      [nomorKirim],
    );

    if (rows.length === 0 || !rows[0].ts_nomor) {
      throw new Error("STBJ ini belum pernah diterima atau tidak ditemukan.");
    }
    const doc = rows[0];

    // --- VALIDASI DARI DELPHI ---
    if (doc.ts_closing === "Y")
      throw new Error("Sudah Closing, tidak bisa dibatalkan.");

    const [sjRows] = await connection.query(
      'SELECT sj_noterima FROM tdc_sj_hdr WHERE sj_stbj = ? AND sj_noterima <> "" LIMIT 1',
      [doc.stbj_nomor],
    );
    if (sjRows.length > 0) {
      throw new Error(
        `Data ini ada SJ ke Store yg sudah diterima dengan Nomor: ${sjRows[0].sj_noterima}`,
      );
    }
    // --- AKHIR VALIDASI ---

    const nomorTerima = doc.ts_nomor;

    // Hapus header dan detail penerimaan
    await connection.query("DELETE FROM tdc_stbj_dtl WHERE tsd_nomor = ?", [
      nomorTerima,
    ]);
    await connection.query("DELETE FROM tdc_stbj_hdr WHERE ts_nomor = ?", [
      nomorTerima,
    ]);

    // ✅ DIHAPUS: UPDATE ke kencanaprint.tstbj_hdr karena column ts_nomor tidak ada
    // await connection.query(
    //   "UPDATE kencanaprint.tstbj_hdr SET ts_nomor = NULL WHERE stbj_nomor = ?",
    //   [nomorKirim]
    // );

    await connection.commit();
    return {
      message: `Penerimaan untuk STBJ dengan nomor ${nomorKirim} berhasil dibatalkan.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const cancelRejection = async (nomorKirim, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Ambil data relevan
    const [rows] = await connection.query(
      `SELECT ts.ts_nomor, tl.tl_nomor 
             FROM kencanaprint.tstbj_hdr h
             LEFT JOIN tdc_stbj_hdr ts ON h.stbj_nomor = ts.ts_stbj
             LEFT JOIN tdc_stbjtolak tl ON h.stbj_nomor = tl.tl_stbj
             WHERE h.stbj_nomor = ?`,
      [nomorKirim],
    );

    if (rows.length === 0) throw new Error("Dokumen STBJ tidak ditemukan.");
    const doc = rows[0];

    // --- VALIDASI DARI DELPHI (cxButton5Click) ---
    if (!doc.tl_nomor) throw new Error("STBJ ini belum ditolak.");
    if (doc.ts_nomor)
      throw new Error(
        "STBJ ini sudah diterima, tidak bisa dibatalkan penolakannya.",
      );

    // Cek apakah sudah dibuat pengiriman dari Gudang Repair
    const [grRows] = await connection.query(
      "SELECT 1 FROM tdc_gr_hdr WHERE gr_tl_nomor = ? LIMIT 1",
      [doc.tl_nomor],
    );
    if (grRows.length > 0) {
      throw new Error(
        "Data ini sudah dibuatkan pengiriman dari Gudang Repair ke DC.",
      );
    }
    // --- AKHIR VALIDASI ---

    // Hapus data penolakan
    await connection.query("DELETE FROM tdc_stbjtolak WHERE tl_nomor = ?", [
      doc.tl_nomor,
    ]);

    await connection.commit();
    return {
      message: `Penolakan untuk STBJ dengan nomor ${nomorKirim} berhasil dibatalkan.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getExportDetails = async (filters) => {
  const { startDate, endDate, gudang } = filters;
  const query = `
        SELECT 
            h.stbj_nomor AS 'Nomor STBJ',
            h.stbj_tanggal AS 'Tgl Kirim',
            g.gdg_nama AS 'Asal Gudang',
            ts.ts_nomor AS 'Nomor Terima',
            d.tsd_packing AS 'Packing',
            ts.ts_tanggal AS 'Tgl Terima',
            d.tsd_spk_nomor AS 'SPK',
            d.tsd_kode AS 'Kode Barang',
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS 'Nama Barang',
            d.tsd_ukuran AS 'Ukuran',
            d.tsd_jumlah AS 'Jumlah'
        FROM kencanaprint.tstbj_hdr h
        INNER JOIN tdc_stbj_hdr ts ON h.stbj_nomor = ts.ts_stbj
        INNER JOIN tdc_stbj_dtl d ON ts.ts_nomor = d.tsd_nomor
        LEFT JOIN kencanaprint.tgudang g ON g.gdg_kode = h.stbj_gdg_kode 
        LEFT JOIN tbarangdc a ON a.brg_kode = d.tsd_kode
        WHERE 
            -- [FIX] Gunakan DATE()
            DATE(h.stbj_tanggal) BETWEEN ? AND ?
            AND h.stbj_gdg_kode = ?
        ORDER BY h.stbj_nomor, d.tsd_spk_nomor, d.tsd_kode, d.tsd_ukuran;
    `;
  const [rows] = await pool.query(query, [startDate, endDate, gudang]);
  return rows;
};

module.exports = {
  getList,
  getDetails,
  cancelRejection,
  getExportDetails,
  getPosisiPenerimaan,
  ringkasPosisi,
};
