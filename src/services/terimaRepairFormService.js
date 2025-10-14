const pool = require("../config/database");
const { format } = require("date-fns");
const sequenceService = require("./sequenceService"); // Panggil service sequence

const loadFromKirim = async (nomorKirim) => {
  // Mengambil data dari dokumen pengiriman Gudang Repair
  const [headerRows] = await pool.query(
    `
        SELECT h.gr_nomor, h.gr_tanggal, h.gr_gudang, g.gdg_nama, h.gr_cab, h.gr_ket
        FROM tdc_gr_hdr h
        LEFT JOIN tgudang g ON g.gdg_kode = h.gr_gudang
        WHERE h.gr_nomor = ?`,
    [nomorKirim]
  );
  if (headerRows.length === 0)
    throw new Error("Dokumen kirim tidak ditemukan.");

  const [items] = await pool.query(
    `
        SELECT 
            d.grd_spk_nomor AS spk, d.grd_kode AS kode, d.grd_ukuran AS ukuran, d.grd_jumlah AS jumlah,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama
        FROM tdc_gr_dtl d
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.grd_kode
        WHERE d.grd_nomor = ?`,
    [nomorKirim]
  );

  return { header: headerRows[0], items };
};

const save = async (payload, user) => {
  const { header, items } = payload;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Generate Nomor Terima Baru
    const nomorTerima = await sequenceService.generateNomorTerimaRepair(
      connection,
      header.tanggal
    );

    // 2. Update header pengiriman (tdc_gr_hdr)
    await connection.query(
      "UPDATE tdc_gr_hdr SET gr_terima = ?, gr_tglterima = ? WHERE gr_nomor = ?",
      [nomorTerima, header.tanggal, header.nomorKirim]
    );

    // 3. Insert detail penerimaan (tdc_gr_dtl2)
    if (items.length > 0) {
      const detailValues = items.map((item, i) => [
        nomorTerima + (i + 1),
        nomorTerima,
        item.spk,
        item.kode,
        item.ukuran,
        item.jumlah,
      ]);
      await connection.query(
        "INSERT INTO tdc_gr_dtl2 (grd2_iddrec, grd2_nomor, grd2_spk_nomor, grd2_kode, grd2_ukuran, grd2_jumlah) VALUES ?",
        [detailValues]
      );
    }

    // --- 4. LOGIKA PEMBUATAN SJ/MUTASI OTOMATIS ---
    const cabangAlokasi = ["KBS", "KPS", "K01", "K02", "K03"]; // Sesuai Delphi
    let mutasiCounter = 0;
    let sjCounter = 0;

    const { lastNum: lastMutasiNum } =
      await sequenceService.generateNomorMutasi(connection, header.tanggal);
    const { lastNum: lastSjNum } = await sequenceService.generateNomorSjStore(
      connection,
      header.tanggal
    );

    for (const cabang of cabangAlokasi) {
      const itemsForCabang = items.filter(
        (item) => item[cabang.toLowerCase()] > 0
      );
      if (itemsForCabang.length > 0) {
        if (["KBS", "KPS"].includes(cabang)) {
          // Buat Dokumen Mutasi
          mutasiCounter++;
          const nomorMutasi = `KDC.MTS.${format(
            new Date(header.tanggal),
            "yyMM"
          )}${(lastMutasiNum + mutasiCounter).toString().padStart(5, "0")}`;
          await connection.query(
            'INSERT INTO tdc_mts_hdr (mts_nomor, mts_tanggal, mts_kecab, mts_ket, mts_stbj, user_create, date_create) VALUES (?, ?, ?, "MUTASI OTOMATIS", ?, ?, NOW())',
            [nomorMutasi, header.tanggal, cabang, header.nomorKirim, user.kode]
          );
          // (Logika insert ke tdc_mts_dtl)
        } else {
          // Buat Dokumen Surat Jalan
          sjCounter++;
          const nomorSj = `KDC.SJ.${format(
            new Date(header.tanggal),
            "yyMM"
          )}.${(lastSjNum + sjCounter).toString().padStart(4, "0")}`;
          await connection.query(
            'INSERT INTO tdc_sj_hdr (sj_nomor, sj_tanggal, sj_kecab, sj_ket, sj_stbj, user_create, date_create) VALUES (?, ?, ?, "SJ OTOMATIS", ?, ?, NOW())',
            [nomorSj, header.tanggal, cabang, header.nomorKirim, user.kode]
          );
          // (Logika insert ke tdc_sj_dtl)
        }
      }
    }
    // --- AKHIR LOGIKA OTOMATIS ---

    await connection.commit();
    return {
      message: `Penerimaan dari Gudang Repair berhasil disimpan dengan nomor ${nomorTerima}`,
      nomor: nomorTerima,
    };
  } catch (error) {
    await connection.rollback();
    console.error("Save Terima Repair Error:", error);
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { loadFromKirim, save };
