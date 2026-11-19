const pool = require("../config/database");
const { format } = require("date-fns");
const {
  generateNomorTerima,
  generateNomorSjGarmen,
  generateNomorMutasi,
  generateNomorSjStore,
} = require("./sequenceService");
const { getPosisiPenerimaan, ringkasPosisi } = require("./terimaStbjService");

// Cabang tujuan alokasi. KBS/KPS = mutasi otomatis, selain itu (KPR, KF1) = SJ otomatis ke store
const CABANG_ALOKASI = ["KBS", "KPS", "KPR", "KF1"];

// --- Main Service Functions ---
const loadFromStbj = async (nomorStbj) => {
  const [headerData] = await pool.query(
    `SELECT h.stbj_nomor, h.stbj_tanggal, g.gdgp_cab, p.pab_nama FROM kencanaprint.tstbj_hdr h LEFT JOIN kencanaprint.tgudangproduksi g ON g.gdgp_kode=h.stbj_gdgp_kode LEFT JOIN kencanaprint.tpabrik p ON p.pab_kode=g.gdgp_kode WHERE h.stbj_nomor = ?`,
    [nomorStbj],
  );
  if (headerData.length === 0) throw new Error("STBJ tidak ditemukan.");

  // Packing per SPK diambil dari tdc_stbj (sumber yang sah), bukan tebakan pack_nostbj
  const [summaryItems] = await pool.query(
    `SELECT d.STBJD_SPK_Nomor AS spk,
            (SELECT GROUP_CONCAT(DISTINCT e.tsd_packing ORDER BY e.tsd_packing SEPARATOR ', ')
               FROM tdc_stbj e
              WHERE e.tsd_nomor = d.STBJD_STBJ_Nomor
                AND e.tsd_spk_nomor = d.STBJD_SPK_Nomor) AS packing,
            g.gdg_nama AS gudang,
            s.spk_nama AS nama,
            IF(d.stbjd_size<>'', d.stbjd_size, s.spk_ukuran) AS ukuran,
            d.STBJD_Jumlah AS jumlah,
            d.STBJD_Koli AS koli,
            d.STBJD_Keterangan AS keterangan
       FROM kencanaprint.tstbj_dtl d
       LEFT JOIN kencanaprint.tspk s ON s.spk_nomor = d.STBJD_SPK_Nomor
       LEFT JOIN kencanaprint.tsalesorder so ON so.so_nomor = s.spk_so_ref AND so.so_aktif = 'Y'
       LEFT JOIN tgudang g ON g.gdg_kode = LEFT(so.so_invdc, 3)
      WHERE d.STBJD_STBJ_Nomor = ?`,
    [nomorStbj],
  );

  // Baris per packing: jumlah (isi packing), diterima, sisa
  const allocationItems = await getPosisiPenerimaan(pool, nomorStbj);
  if (allocationItems.length === 0) {
    throw new Error("STBJ ini belum punya data packing.");
  }
  const ringkasan = ringkasPosisi(allocationItems);
  if (ringkasan.kekurangan <= 0) {
    throw new Error("STBJ ini sudah diterima seluruhnya.");
  }

  return { header: headerData[0], summaryItems, allocationItems, ringkasan };
};

const save = async (payload, user) => {
  let retries = 5;
  while (retries > 0) {
    const connection = await pool.getConnection();
    const seqConnection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const { header } = payload;
      const tanggal = header.tanggal;
      const nomorStbj = header.nomorStbj;

      // Hanya baris yang benar-benar diterima kali ini
      const allocationItems = (payload.allocationItems || []).filter(
        (item) => Number(item.jumlah) > 0,
      );
      if (allocationItems.length === 0) {
        throw new Error("Pilih minimal satu packing dengan qty diterima.");
      }

      // Kunci header STBJ: dua penerimaan bersamaan atas STBJ yang sama harus berurutan.
      // Harus jadi query pertama di transaksi ini supaya hitungan sisa di bawah
      // melihat penerimaan yang baru di-commit transaksi lain.
      const [stbjRows] = await connection.query(
        "SELECT stbj_nomor FROM kencanaprint.tstbj_hdr WHERE stbj_nomor = ? FOR UPDATE",
        [nomorStbj],
      );
      if (stbjRows.length === 0) throw new Error("STBJ tidak ditemukan.");

      // Validasi di server: qty tidak boleh melebihi sisa per packing, dan
      // pengecekan di frontend saja tidak cukup
      const posisi = await getPosisiPenerimaan(connection, nomorStbj);
      const posisiMap = new Map(
        posisi.map((r) => [`${r.packing}|${r.spk}|${r.kode}|${r.ukuran}`, r]),
      );
      const sudahDipakai = new Set();

      for (const item of allocationItems) {
        const label = `${item.packing || "(tanpa packing)"} / ${item.spk} ${item.kode} ${item.ukuran}`;
        const key = `${item.packing}|${item.spk}|${item.kode}|${item.ukuran}`;
        const baris = posisiMap.get(key);
        if (!baris) {
          throw new Error(`Baris ${label} tidak ada di STBJ ${nomorStbj}.`);
        }
        if (sudahDipakai.has(key)) {
          throw new Error(`Baris ${label} terkirim dobel.`);
        }
        sudahDipakai.add(key);

        const qty = Number(item.jumlah);
        if (qty > baris.sisa + 1e-9) {
          throw new Error(
            `${label}: qty ${qty} melebihi sisa yang belum diterima (${baris.sisa}).`,
          );
        }

        const alokasi = CABANG_ALOKASI.map(
          (c) => Number(item[c.toLowerCase()]) || 0,
        );
        if (alokasi.some((q) => q < 0)) {
          throw new Error(`Alokasi untuk ${label} tidak boleh negatif.`);
        }
        if (alokasi.reduce((s, q) => s + q, 0) > qty) {
          throw new Error(`Alokasi untuk ${label} melebihi qty diterima.`);
        }
      }

      const nomorTerima = await generateNomorTerima(seqConnection, tanggal);
      const nomorSjGarmen = "";

      await connection.query(
        "INSERT INTO tdc_stbj_hdr (ts_nomor, ts_tanggal, ts_sj_garmen, ts_stbj, user_create, date_create) VALUES (?, ?, ?, ?, ?, NOW())",
        [nomorTerima, header.tanggal, nomorSjGarmen, nomorStbj, user.kode],
      );

      // Unit fisik berstatus DICETAK per SPK/kode/ukuran dimuat sekali lalu
      // dibagi berurutan ke tiap baris packing, jadi serial tidak pernah terpakai dua kali.
      // Soft-fallback: kalau unit kurang (barang masih barcode lama), sisanya masuk
      // sebagai 1 baris agregat legacy (unit_serial NULL), bukan menolak transaksi.
      const poolUnit = new Map();
      const ambilUnit = async (spk, kode, ukuran, count) => {
        const key = `${spk}|${kode}|${ukuran}`;
        if (!poolUnit.has(key)) {
          const [units] = await connection.query(
            `SELECT unit_serial FROM tbarangdc_unit
             WHERE unit_spk_nomor = ? AND unit_kode = ? AND unit_ukuran = ?
               AND unit_status = 'DICETAK'
             ORDER BY date_create ASC, unit_serial ASC
             FOR UPDATE`,
            [spk, kode, ukuran],
          );
          poolUnit.set(
            key,
            units.map((u) => u.unit_serial),
          );
        }
        return poolUnit.get(key).splice(0, count);
      };

      const stbjDtlValues = [];
      const itemUnitMap = []; // sisa serial & sisa qty legacy per baris, dipakai lagi di tahap mutasi/SJ di bawah
      let stbjDtlIdx = 0;

      for (const item of allocationItems) {
        const jumlah = Number(item.jumlah) || 0;

        const serials = await ambilUnit(
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
            item.packing,
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
            item.packing,
            item.spk,
            item.kode,
            item.ukuran,
            legacyQty,
            null, // tsd_unit_serial NULL — baris agregat legacy
          ]);
        }
      }

      await connection.query(
        "INSERT INTO tdc_stbj_dtl (tsd_iddrec, tsd_nomor, tsd_packing, tsd_spk_nomor, tsd_kode, tsd_ukuran, tsd_jumlah, tsd_unit_serial) VALUES ?",
        [stbjDtlValues],
      );
      const allSerials = stbjDtlValues
        .map((r) => r[7])
        .filter((s) => s !== null);
      if (allSerials.length > 0) {
        await connection.query(
          `UPDATE tbarangdc_unit SET unit_status = 'DI_DC', unit_lokasi_saat_ini = 'KDC',
             unit_stbj_nomor = ?, date_modified = NOW(), user_modified = ?
           WHERE unit_serial IN (?)`,
          [nomorTerima, user.kode, allSerials],
        );
      }

      // Hanya penerimaan pertama yang mengisi penanda; yang berikutnya tidak menimpa
      await connection.query(
        "UPDATE kencanaprint.tstbj_hdr SET stbj_ts_nomor = ? WHERE stbj_nomor = ? AND stbj_ts_nomor = ''",
        [nomorTerima, nomorStbj],
      );

      for (const cabang of CABANG_ALOKASI) {
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
          // KPR dan KF1 — SJ Otomatis ke Store
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

      // Posisi setelah penerimaan ini, dihitung dalam transaksi yang sama
      const ringkasan = ringkasPosisi(
        await getPosisiPenerimaan(connection, nomorStbj),
      );

      await connection.commit();
      seqConnection.release();
      connection.release();

      return {
        message: `Penerimaan STBJ berhasil disimpan dengan nomor ${nomorTerima}`,
        nomor: nomorTerima,
        ringkasan,
      };
    } catch (error) {
      await connection.rollback();
      if (seqConnection) seqConnection.release();
      if (connection) connection.release();

      if (error.code === "ER_DUP_ENTRY") {
        console.error("[TERIMA STBJ] ER_DUP_ENTRY:", error.sqlMessage);
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
