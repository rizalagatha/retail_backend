const pool = require("../config/database");
const { format } = require("date-fns");
const {
  generateNomorTerima,
  generateNomorSjGarmen,
  generateNomorMutasi,
  generateNomorSjStore,
} = require("./sequenceService");

// --- Main Service Functions ---
const loadFromStbj = async (nomorStbj) => {
  const [headerData] = await pool.query(
    `SELECT h.stbj_nomor, h.stbj_tanggal, g.gdgp_cab, p.pab_nama FROM kencanaprint.tstbj_hdr h LEFT JOIN kencanaprint.tgudangproduksi g ON g.gdgp_kode=h.stbj_gdgp_kode LEFT JOIN kencanaprint.tpabrik p ON p.pab_kode=g.gdgp_kode WHERE h.stbj_nomor = ?`,
    [nomorStbj]
  );
  if (headerData.length === 0) throw new Error("STBJ tidak ditemukan.");

  const [summaryItems] = await pool.query(
    `SELECT d.STBJD_SPK_Nomor AS spk, s.spk_nama AS nama, IF(d.stbjd_size<>'', d.stbjd_size, s.spk_ukuran) AS ukuran, d.STBJD_Jumlah AS jumlah, d.STBJD_Koli AS koli, d.STBJD_Keterangan AS keterangan FROM kencanaprint.tstbj_dtl d LEFT JOIN kencanaprint.tspk s ON s.spk_nomor=d.STBJD_SPK_Nomor WHERE d.STBJD_STBJ_Nomor = ?`,
    [nomorStbj]
  );

  const [allocationItems] = await pool.query(
    `SELECT e.tsd_spk_nomor AS spk, e.tsd_kode AS kode, e.tsd_ukuran AS ukuran, e.tsd_jumlah AS jumlah, concat(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna) AS nama FROM tdc_stbj e LEFT JOIN tbarangdc a ON a.brg_kode=e.tsd_kode WHERE e.tsd_nomor = ?`,
    [nomorStbj]
  );

  return { header: headerData[0], summaryItems, allocationItems };
};

const save = async (payload, user) => {
  let retries = 5;
  while (retries > 0) {
    const seqConnection = await pool.getConnection();
    const connection = await pool.getConnection();

    try {
      const { header, allocationItems } = payload; // summaryItems tidak lagi dibutuhkan untuk SJ Garmen
      const tanggal = header.tanggal;

      // 1. Generate nomor terima (TS)
      const nomorTerima = await generateNomorTerima(seqConnection, tanggal);

      // [PERBAIKAN] SJ Garmen dikosongkan sesuai referensi Delphi (anomor := '')
      const nomorSjGarmen = "";

      seqConnection.release();
      await connection.beginTransaction();

      try {
        // 1. Insert Header Penerimaan (tdc_stbj_hdr)
        await connection.query(
          "INSERT INTO tdc_stbj_hdr (ts_nomor, ts_tanggal, ts_sj_garmen, ts_stbj, user_create, date_create) VALUES (?, ?, ?, ?, ?, NOW())",
          [
            nomorTerima,
            header.tanggal,
            nomorSjGarmen, // Disimpan sebagai string kosong
            header.nomorStbj,
            user.kode,
          ]
        );

        // 2. Insert Detail Penerimaan (tdc_stbj_dtl)
        if (allocationItems.length > 0) {
          const stbjDtlValues = allocationItems.map((item, i) => [
            nomorTerima + (i + 1).toString(),
            nomorTerima,
            item.spk,
            item.kode,
            item.ukuran,
            item.jumlah,
          ]);
          await connection.query(
            "INSERT INTO tdc_stbj_dtl (tsd_iddrec, tsd_nomor, tsd_spk_nomor, tsd_kode, tsd_ukuran, tsd_jumlah) VALUES ?",
            [stbjDtlValues]
          );
        }

        // --- [BAGIAN SJ GARMEN (kencanaprint.tsj_hdr/dtl) DIHAPUS DARI SINI] ---

        // 3. Update referensi di tabel STBJ Produksi (tstbj_hdr)
        await connection.query(
          "UPDATE kencanaprint.tstbj_hdr SET stbj_ts_nomor = ? WHERE stbj_nomor = ?",
          [nomorTerima, header.nomorStbj]
        );

        // 4. Proses Otomatis Pembuatan Dokumen Mutasi & SJ Cabang
        // (Logika ini tetap dipertahankan karena ini adalah distribusi internal DC)
        const cabangAlokasi = [
          "KBS",
          "KPS",
          "KPR",
          "K01",
          "K02",
          "K03",
          "K04",
          "K05",
          "K06",
        ];

        for (const cabang of cabangAlokasi) {
          const itemsForCabang = allocationItems.filter(
            (item) => item[cabang.toLowerCase()] > 0
          );

          if (itemsForCabang.length > 0) {
            if (["KBS", "KPS"].includes(cabang)) {
              // Logic Mutasi Otomatis (Tetap)
              const mutasiSeqConn = await pool.getConnection();
              const mutasiResult = await generateNomorMutasi(
                mutasiSeqConn,
                tanggal
              );
              mutasiSeqConn.release();
              const nomorMutasi = mutasiResult.nextNomor;

              await connection.query(
                'INSERT INTO tdc_mts_hdr (mts_nomor, mts_tanggal, mts_kecab, mts_ket, mts_stbj, user_create, date_create) VALUES (?, ?, ?, "MUTASI OTOMATIS", ?, ?, NOW())',
                [nomorMutasi, tanggal, cabang, header.nomorStbj, user.kode]
              );

              const mutasiDtlValues = itemsForCabang.map((item) => [
                nomorMutasi,
                `${cabang}.MTS.${format(new Date(tanggal), "yyMM")}${(1)
                  .toString()
                  .padStart(5, "0")}`, // Nomor In (Sesuai Delphi)
                item.spk,
                item.kode,
                item.ukuran,
                item[cabang.toLowerCase()],
              ]);

              await connection.query(
                "INSERT INTO tdc_mts_dtl (mtsd_nomor, mtsd_nomorin, mtsd_spk, mtsd_kode, mtsd_ukuran, mtsd_jumlah) VALUES ?",
                [mutasiDtlValues]
              );
            } else {
              // Logic SJ Otomatis ke Store (Tetap)
              const sjSeqConn = await pool.getConnection();
              const sjStoreResult = await generateNomorSjStore(
                sjSeqConn,
                tanggal
              );
              sjSeqConn.release();
              const nomorSj = sjStoreResult.nextNomor;

              await connection.query(
                'INSERT INTO tdc_sj_hdr (sj_nomor, sj_tanggal, sj_kecab, sj_ket, sj_stbj, user_create, date_create) VALUES (?, ?, ?, "SJ OTOMATIS", ?, ?, NOW())',
                [nomorSj, tanggal, cabang, header.nomorStbj, user.kode]
              );

              const sjDtlValues = itemsForCabang.map((item) => [
                nomorSj,
                item.spk,
                item.kode,
                item.ukuran,
                item[cabang.toLowerCase()],
              ]);

              await connection.query(
                "INSERT INTO tdc_sj_dtl (sjd_nomor, sjd_spk, sjd_kode, sjd_ukuran, sjd_jumlah) VALUES ?",
                [sjDtlValues]
              );
            }
          }
        }

        await connection.commit();
        return {
          message: `Penerimaan STBJ berhasil disimpan dengan nomor ${nomorTerima}`,
          nomor: nomorTerima,
        };
      } catch (innerError) {
        await connection.rollback();
        throw innerError;
      }
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        retries--;
        await new Promise((res) => setTimeout(res, Math.random() * 100));
        if (retries === 0) throw new Error("Gagal mendapatkan nomor unik.");
        continue;
      } else {
        throw error;
      }
    } finally {
      if (connection) connection.release();
      if (seqConnection) seqConnection.release();
    }
  }
};

module.exports = { loadFromStbj, save };
