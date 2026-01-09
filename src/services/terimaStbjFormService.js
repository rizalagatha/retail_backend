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
    // ✅ PENTING: Ambil connection BARU untuk generate nomor (AUTOCOMMIT)
    const seqConnection = await pool.getConnection();
    const connection = await pool.getConnection();

    try {
      const { header, summaryItems, allocationItems } = payload;
      const tanggal = header.tanggal;

      // ✅ PENTING: Generate nomor OUTSIDE transaksi main
      // Connection ini dalam mode AUTOCOMMIT
      const nomorTerima = await generateNomorTerima(seqConnection, tanggal);
      const nomorSjGarmen =
        header.nomorSjGarmen ||
        (await generateNomorSjGarmen(seqConnection, tanggal));

      // Release sequence connection
      seqConnection.release();

      await connection.beginTransaction();

      try {
        // 1. Insert Header Penerimaan
        await connection.query(
          "INSERT INTO tdc_stbj_hdr (ts_nomor, ts_tanggal, ts_sj_garmen, ts_stbj, user_create, date_create) VALUES (?, ?, ?, ?, ?, NOW())",
          [
            nomorTerima,
            header.tanggal,
            nomorSjGarmen,
            header.nomorStbj,
            user.kode,
          ]
        );

        // 2. Insert Detail Penerimaan (dari Grid 2)
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

        // ✅ PERBAIKAN UTAMA: Konsolidasi summaryItems agar tidak duplikat di tsj_dtl
        const consolidatedSjItems = summaryItems.reduce((acc, current) => {
          // Buat key unik berdasarkan SPK dan Ukuran
          const key = `${current.spk}-${current.ukuran}`;
          if (!acc[key]) {
            acc[key] = { ...current };
          } else {
            // Jika sudah ada, tambahkan jumlah dan kolinya
            acc[key].jumlah += Number(current.jumlah || 0);
            acc[key].koli += Number(current.koli || 0);
          }
          return acc;
        }, {});

        // 3. Insert Detail SJ Garmen (dari Grid 1) - Pola Delete-then-Insert
        await connection.query(
          "DELETE FROM kencanaprint.tsj_dtl WHERE sjd_sj_nomor = ?",
          [nomorSjGarmen]
        );
        const summaryRows = Object.values(consolidatedSjItems);
        if (summaryRows.length > 0) {
          const sjDtlValues = summaryRows.map((item) => [
            nomorSjGarmen,
            item.spk,
            item.ukuran,
            item.jumlah,
            item.koli,
            item.keterangan,
          ]);
          await connection.query(
            "INSERT INTO kencanaprint.tsj_dtl (sjd_sj_nomor, sjd_spk_nomor, sjd_ukuran, sjd_jumlah, sjd_koli, sjd_keterangan) VALUES ?",
            [sjDtlValues]
          );
        }

        // 4. Proses Otomatis Pembuatan Dokumen Mutasi & SJ
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
              // ✅ PENTING: Generate nomor mutasi di connection transaksi ini
              // TAPI buat connection terpisah untuk sequence
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
                  .padStart(5, "0")}`,
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
              // ✅ PENTING: Generate nomor SJ di connection terpisah
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
        connection.release();
        return {
          message: `Penerimaan STBJ berhasil disimpan dengan nomor ${nomorTerima}`,
          nomor: nomorTerima,
        };
      } catch (innerError) {
        await connection.rollback();
        throw innerError; // Lemparkan ke catch di luar untuk dicek retries-nya
      }
    } catch (error) {
      // ✅ FIX UTAMA: Jika duplicate, jangan langsung "throw". Kurangi retries dan loop lagi.
      if (error.code === "ER_DUP_ENTRY") {
        retries--;
        console.warn(
          `Tabrakan Nomor Dokumen. Mencoba ulang... Sisa retry: ${retries}`
        );
        // Tunggu sebentar sebelum mencoba lagi (jitter)
        await new Promise((res) => setTimeout(res, Math.random() * 100));

        if (retries === 0)
          throw new Error(
            "Gagal mendapatkan nomor dokumen unik setelah beberapa kali percobaan."
          );
        continue; // Lanjut ke iterasi while berikutnya
      } else {
        // Jika error lain (bukan duplicate), langsung lempar error
        throw error;
      }
    } finally {
      if (connection) connection.release();
      if (seqConnection) seqConnection.release();
    }
  }
};

module.exports = { loadFromStbj, save };
