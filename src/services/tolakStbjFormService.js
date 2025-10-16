const pool = require("../config/database");
const { format } = require("date-fns");
const sequenceService = require("./sequenceService"); // Panggil service sequence Anda

const loadFromStbj = async (nomorStbj) => {
  // Query untuk header dan tabel ringkasan (Grid 1)
  const [summaryData] = await pool.query(
    `
        SELECT 
            h.stbj_nomor, h.stbj_tanggal, h.stbj_keterangan, 
            g.gdgp_cab, p.pab_nama,
            d.STBJD_SPK_Nomor AS spk, s.spk_nama AS nama, 
            IF(d.stbjd_size<>'', d.stbjd_size, s.spk_ukuran) AS ukuran, 
            d.STBJD_Jumlah AS jumlah, d.STBJD_Koli AS koli, d.STBJD_Keterangan AS keterangan 
        FROM kencanaprint.tstbj_hdr h
        INNER JOIN kencanaprint.tstbj_dtl d ON d.STBJD_STBJ_Nomor = h.stbj_nomor
        LEFT JOIN kencanaprint.tspk s ON s.spk_nomor = d.STBJD_SPK_Nomor
        LEFT JOIN kencanaprint.tgudangproduksi g ON g.gdgp_kode = h.stbj_gdgp_kode 
        LEFT JOIN kencanaprint.tpabrik p ON p.pab_kode = g.gdgp_cab 
        WHERE h.stbj_nomor = ?`,
    [nomorStbj]
  );
  if (summaryData.length === 0) throw new Error("STBJ tidak ditemukan.");

  // Query untuk tabel detail barang (Grid 2)
  const [detailItems] = await pool.query(
    `
        SELECT 
            e.tsd_spk_nomor AS spk, e.tsd_kode AS kode, e.tsd_ukuran AS ukuran, e.tsd_jumlah AS jumlah, 
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama 
        FROM tdc_stbj e 
        LEFT JOIN retail.tbarangdc a ON a.brg_kode=e.tsd_kode 
        WHERE e.tsd_nomor = ?`,
    [nomorStbj]
  );

  return {
    header: summaryData[0],
    summaryItems: summaryData,
    detailItems: detailItems,
  };
};

const save = async (payload, user) => {
  const { header, items } = payload;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Panggil fungsi generate nomor penolakan yang baru
    const nomorTolak = await sequenceService.generateNomorTolakStbj(
      connection,
      header.tanggal
    );

    // 2. Insert header penolakan
    await connection.query(
      "INSERT INTO tdc_stbjtolak (tl_nomor, tl_tanggal, tl_stbj, tl_gdg_repair, tl_cab, user_create, date_create) VALUES (?, ?, ?, ?, ?, ?, NOW())",
      [
        nomorTolak,
        header.tanggal,
        header.nomorStbj,
        header.gudangRepair,
        header.gudangAsal,
        user.kode,
      ]
    );

    await connection.commit();
    return {
      message: `Penolakan STBJ berhasil disimpan dengan nomor ${nomorTolak}`,
      nomor: nomorTolak,
    };
  } catch (error) {
    await connection.rollback();
    console.error("Save Tolak STBJ Error:", error);
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { loadFromStbj, save };
