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
    [nomorStbj],
  );
  if (headerData.length === 0) throw new Error("STBJ tidak ditemukan.");

  const [summaryItems] = await pool.query(
    `SELECT d.STBJD_SPK_Nomor AS spk, s.spk_nama AS nama, IF(d.stbjd_size<>'', d.stbjd_size, s.spk_ukuran) AS ukuran, d.STBJD_Jumlah AS jumlah, d.STBJD_Koli AS koli, d.STBJD_Keterangan AS keterangan FROM kencanaprint.tstbj_dtl d LEFT JOIN kencanaprint.tspk s ON s.spk_nomor=d.STBJD_SPK_Nomor WHERE d.STBJD_STBJ_Nomor = ?`,
    [nomorStbj],
  );

  const [allocationItems] = await pool.query(
    `SELECT e.tsd_spk_nomor AS spk, e.tsd_kode AS kode, e.tsd_ukuran AS ukuran, e.tsd_jumlah AS jumlah, concat(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna) AS nama FROM tdc_stbj e LEFT JOIN tbarangdc a ON a.brg_kode=e.tsd_kode WHERE e.tsd_nomor = ?`,
    [nomorStbj],
  );

  return { header: headerData[0], summaryItems, allocationItems };
};

// UBAH: soft-fallback — ambil unit fisik status DICETAK sebanyak yang
// TERSEDIA (bisa kurang dari count kalau barang ini masih pakai barcode
// format lama / belum sempat dicetak sebagai unit unik). Sisa yang tidak
// ketemu unit-nya nanti dicatat sebagai baris agregat legacy
// (unit_serial=NULL), BUKAN ditolak total seperti sebelumnya.
const selectAvailableUnitsSoft = async (
  connection,
  spk,
  kode,
  ukuran,
  count,
) => {
  const [units] = await connection.query(
    `SELECT unit_serial FROM tbarangdc_unit
     WHERE unit_spk_nomor = ? AND unit_kode = ? AND unit_ukuran = ?
       AND unit_status = 'DICETAK'
     ORDER BY date_create ASC, unit_serial ASC
     FOR UPDATE`,
    [spk, kode, ukuran],
  );
  return units.slice(0, count).map((u) => u.unit_serial);
};

const save = async (payload, user) => {
  let retries = 5;
  while (retries > 0) {
    const connection = await pool.getConnection();
    const seqConnection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const { header, allocationItems } = payload;
      const tanggal = header.tanggal;

      const nomorTerima = await generateNomorTerima(seqConnection, tanggal);
      const nomorSjGarmen = "";

      await connection.query(
        "INSERT INTO tdc_stbj_hdr (ts_nomor, ts_tanggal, ts_sj_garmen, ts_stbj, user_create, date_create) VALUES (?, ?, ?, ?, ?, NOW())",
        [
          nomorTerima,
          header.tanggal,
          nomorSjGarmen,
          header.nomorStbj,
          user.kode,
        ],
      );

      // UBAH: dual-mode — sebanyak mungkin diserialisasi per unit,
      // sisanya (barang masih barcode lama / belum sempat dicetak
      // sebagai unit) masuk sebagai 1 baris agregat legacy per item
      // (unit_serial=NULL), bukan menolak transaksi total.
      const stbjDtlValues = [];
      const itemUnitMap = []; // simpan sisa serial & sisa qty legacy per item, dipakai lagi di tahap mutasi/SJ di bawah
      let stbjDtlIdx = 0;

      for (const item of allocationItems) {
        const jumlah = Number(item.jumlah) || 0;
        if (jumlah <= 0) continue;

        const serials = await selectAvailableUnitsSoft(
          connection,
          item.spk,
          item.kode,
          item.ukuran,
          jumlah,
        );
        const legacyQty = jumlah - serials.length;
        itemUnitMap.push({ item, serials: [...serials], legacyQty });

        for (const serial of serials) {
          stbjDtlIdx++;
          stbjDtlValues.push([
            nomorTerima + stbjDtlIdx.toString().padStart(3, "0"),
            nomorTerima,
            item.spk,
            item.kode,
            item.ukuran,
            1,
            serial,
          ]);
        }

        if (legacyQty > 0) {
          stbjDtlIdx++;
          stbjDtlValues.push([
            nomorTerima + stbjDtlIdx.toString().padStart(3, "0"),
            nomorTerima,
            item.spk,
            item.kode,
            item.ukuran,
            legacyQty,
            null, // tsd_unit_serial NULL — baris agregat legacy
          ]);
        }
      }

      if (stbjDtlValues.length > 0) {
        await connection.query(
          "INSERT INTO tdc_stbj_dtl (tsd_iddrec, tsd_nomor, tsd_spk_nomor, tsd_kode, tsd_ukuran, tsd_jumlah, tsd_unit_serial) VALUES ?",
          [stbjDtlValues],
        );
        const allSerials = stbjDtlValues.map((r) => r[6]);
        await connection.query(
          `UPDATE tbarangdc_unit SET unit_status = 'DI_DC', unit_lokasi_saat_ini = 'KDC',
             unit_stbj_nomor = ?, date_modified = NOW(), user_modified = ?
           WHERE unit_serial IN (?)`,
          [nomorTerima, user.kode, allSerials],
        );
      }

      await connection.query(
        "UPDATE kencanaprint.tstbj_hdr SET stbj_ts_nomor = ? WHERE stbj_nomor = ?",
        [nomorTerima, header.nomorStbj],
      );

      const cabangAlokasi = ["KBS", "KPS", "KPR"];

      for (const cabang of cabangAlokasi) {
        const key = cabang.toLowerCase();
        const itemsForCabang = allocationItems.filter((item) => item[key] > 0);
        if (itemsForCabang.length === 0) continue;

        // UBAH: ambil dari pool unit_serial dulu, sisanya dari pool
        // legacy (qty agregat) — dua-duanya sudah dialokasikan ke DC
        // di atas, sejumlah item[key], dari sisa yang belum kepakai
        // cabang lain.
        const pickForCabang = (item, qty) => {
          const found = itemUnitMap.find((m) => m.item === item);
          if (!found) return { serials: [], legacyQty: 0 };
          const serials = found.serials.splice(0, qty);
          const remaining = qty - serials.length;
          const legacyQty = Math.min(remaining, found.legacyQty);
          found.legacyQty -= legacyQty;
          return { serials, legacyQty };
        };

        if (["KBS", "KPS"].includes(cabang)) {
          const mutasiResult = await generateNomorMutasi(
            seqConnection,
            tanggal,
          );
          const nomorMutasi = mutasiResult.nextNomor;

          await connection.query(
            'INSERT INTO tdc_mts_hdr (mts_nomor, mts_tanggal, mts_kecab, mts_ket, mts_stbj, user_create, date_create) VALUES (?, ?, ?, "MUTASI OTOMATIS", ?, ?, NOW())',
            [nomorMutasi, tanggal, cabang, header.nomorStbj, user.kode],
          );

          const mutasiDtlValues = [];
          const mutasiSerials = [];
          let mtsIdx = 0;
          for (const item of itemsForCabang) {
            const qty = Number(item[key]) || 0;
            if (qty <= 0) continue;
            const { serials, legacyQty } = pickForCabang(item, qty);

            for (const serial of serials) {
              mtsIdx++;
              // BARU: mtsd_iddrec unik per baris — dulu tidak diisi (bug,
              // semua baris jadi '' dan nabrak di trigger)
              const mtsdIddrec = `${nomorMutasi}${mtsIdx.toString().padStart(3, "0")}`;
              mutasiDtlValues.push([
                mtsdIddrec,
                nomorMutasi,
                `${cabang}.MTS.${format(new Date(tanggal), "yyMM")}${mtsIdx.toString().padStart(5, "0")}`,
                item.spk,
                item.kode,
                item.ukuran,
                1,
                serial,
              ]);
              mutasiSerials.push(serial);
            }

            // UBAH: sisa qty yang tidak ketemu unit_serial — tetap
            // masuk sebagai 1 baris agregat legacy (unit_serial NULL)
            if (legacyQty > 0) {
              mtsIdx++;
              const mtsdIddrec = `${nomorMutasi}${mtsIdx.toString().padStart(3, "0")}`;
              mutasiDtlValues.push([
                mtsdIddrec,
                nomorMutasi,
                `${cabang}.MTS.${format(new Date(tanggal), "yyMM")}${mtsIdx.toString().padStart(5, "0")}`,
                item.spk,
                item.kode,
                item.ukuran,
                legacyQty,
                null,
              ]);
            }
          }

          if (mutasiDtlValues.length > 0) {
            await connection.query(
              "INSERT INTO tdc_mts_dtl (mtsd_iddrec, mtsd_nomor, mtsd_nomorin, mtsd_spk, mtsd_kode, mtsd_ukuran, mtsd_jumlah, mtsd_unit_serial) VALUES ?",
              [mutasiDtlValues],
            );
            if (mutasiSerials.length > 0) {
              await connection.query(
                `UPDATE tbarangdc_unit SET unit_status = ?, unit_lokasi_saat_ini = ?,
                   date_modified = NOW(), user_modified = ?
                 WHERE unit_serial IN (?)`,
                [`DI_${cabang}`, cabang, user.kode, mutasiSerials],
              );
            }
          }
        } else {
          // KPR — SJ Otomatis ke Store
          const sjStoreResult = await generateNomorSjStore(
            seqConnection,
            tanggal,
          );
          const nomorSj = sjStoreResult.nextNomor;

          await connection.query(
            'INSERT INTO tdc_sj_hdr (sj_nomor, sj_tanggal, sj_kecab, sj_ket, sj_stbj, user_create, date_create) VALUES (?, ?, ?, "SJ OTOMATIS", ?, ?, NOW())',
            [nomorSj, tanggal, cabang, header.nomorStbj, user.kode],
          );

          const sjDtlValues = [];
          const sjSerials = [];
          let sjIdx = 0;
          for (const item of itemsForCabang) {
            const qty = Number(item[key]) || 0;
            if (qty <= 0) continue;
            const { serials, legacyQty } = pickForCabang(item, qty);

            for (const serial of serials) {
              sjIdx++;
              // BARU: sjd_iddrec unik per baris — sama, dulu tidak diisi
              const sjdIddrec = `${nomorSj}${sjIdx.toString().padStart(3, "0")}`;
              sjDtlValues.push([
                sjdIddrec,
                nomorSj,
                item.spk,
                item.kode,
                item.ukuran,
                1,
                serial,
              ]);
              sjSerials.push(serial);
            }

            // UBAH: sisa qty tanpa unit_serial — baris agregat legacy
            if (legacyQty > 0) {
              sjIdx++;
              const sjdIddrec = `${nomorSj}${sjIdx.toString().padStart(3, "0")}`;
              sjDtlValues.push([
                sjdIddrec,
                nomorSj,
                item.spk,
                item.kode,
                item.ukuran,
                legacyQty,
                null,
              ]);
            }
          }

          if (sjDtlValues.length > 0) {
            await connection.query(
              "INSERT INTO tdc_sj_dtl (sjd_iddrec, sjd_nomor, sjd_spk, sjd_kode, sjd_ukuran, sjd_jumlah, sjd_unit_serial) VALUES ?",
              [sjDtlValues],
            );
            if (sjSerials.length > 0) {
              await connection.query(
                `UPDATE tbarangdc_unit SET unit_status = 'DIKIRIM',
                   date_modified = NOW(), user_modified = ?
                 WHERE unit_serial IN (?)`,
                [user.kode, sjSerials],
              );
            }
          }
        }
      }

      await connection.commit();
      seqConnection.release();
      connection.release();

      return {
        message: `Penerimaan STBJ berhasil disimpan dengan nomor ${nomorTerima}`,
        nomor: nomorTerima,
      };
    } catch (error) {
      await connection.rollback();
      if (seqConnection) seqConnection.release();
      if (connection) connection.release();

      if (error.code === "ER_DUP_ENTRY") {
        retries--;
        if (retries === 0) {
          throw new Error(
            "Gagal menyimpan data setelah beberapa kali percobaan karena nomor duplikat.",
          );
        }
        await new Promise((res) => setTimeout(res, Math.random() * 200));
      } else {
        throw error;
      }
    }
  }
};

module.exports = { loadFromStbj, save };
