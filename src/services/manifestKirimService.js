const pool = require("../config/database");
const { format } = require("date-fns");

/**
 * Generates a new Manifest Kirim number.
 * Format: [GUDANG].MP.[YYMM].[NNNN] (e.g. KDC.MP.2608.0001)
 */
const generateNewManifestNumber = async (gudang, tanggal) => {
    const dateObj = new Date(tanggal);
    const year = format(dateObj, "yy");
    const month = format(dateObj, "MM");
    const prefix = `${gudang}.MP.${year}${month}.`;

    const query = `
    SELECT IFNULL(MAX(RIGHT(mp_nomor, 4)), 0) + 1 AS next_num
    FROM tmanifest_pengiriman_hdr 
    WHERE mp_nomor LIKE ?;
  `;
    const [rows] = await pool.query(query, [`${prefix}%`]);
    const nextNumber = rows[0].next_num.toString().padStart(4, "0");

    return `${prefix}${nextNumber}`;
};

/**
 * Retrieves list of Manifest Kirim headers based on filters.
 */
const getList = async (filters) => {
    const { startDate, endDate, gudang, status, search } = filters;
    let params = [startDate, endDate];
    let whereConditions = ["h.mp_tanggal BETWEEN ? AND ?"];

    if (gudang && gudang !== "") {
        whereConditions.push("h.mp_gudang = ?");
        params.push(gudang);
    }

    if (status && status !== "") {
        whereConditions.push("h.mp_status = ?");
        params.push(status);
    }

    if (search && search.trim() !== "") {
        whereConditions.push(
            "(h.mp_nomor LIKE ? OR h.mp_driver LIKE ? OR h.mp_plat_nomor LIKE ? OR h.mp_ekspedisi LIKE ? OR h.mp_no_resi LIKE ?)",
        );
        const searchPattern = `%${search.trim()}%`;
        params.push(
            searchPattern,
            searchPattern,
            searchPattern,
            searchPattern,
            searchPattern,
        );
    }

    const query = `
    SELECT 
      h.mp_nomor AS Nomor,
      h.mp_tanggal AS Tanggal,
      h.mp_jam AS Jam,
      h.mp_gudang AS Gudang,
      g.gdg_nama AS NamaGudang,
      h.mp_tujuan AS Tujuan,
      h.mp_jenis_kirim AS JenisKirim,
      h.mp_driver AS Driver,
      h.mp_plat_nomor AS PlatNomor,
      h.mp_ekspedisi AS Ekspedisi,
      h.mp_no_resi AS NoResi,
      h.mp_total_sj AS TotalSj,
      h.mp_total_koli AS TotalKoli,
      h.mp_total_qty AS TotalQty,
      h.mp_berat_kg AS BeratKg,
      h.mp_ket AS Keterangan,
      h.mp_status AS Status,
      h.user_create AS Usr,
      h.date_create AS DateCreate
    FROM tmanifest_pengiriman_hdr h
    LEFT JOIN tgudang g ON g.gdg_kode = h.mp_gudang
    WHERE ${whereConditions.join(" AND ")}
    ORDER BY h.date_create DESC;
  `;

    const [rows] = await pool.query(query, params);
    return rows;
};

/**
 * Retrieves details (header + SJ items) of a specific Manifest Kirim.
 */
const getDetails = async (nomor) => {
    const headerQuery = `
    SELECT 
      h.mp_nomor AS nomor,
      h.mp_tanggal AS tanggal,
      h.mp_jam AS jam,
      h.mp_gudang AS gudang,
      g.gdg_nama AS namaGudang,
      h.mp_tujuan AS tujuan,
      gt.gdg_nama AS namaTujuan,
      h.mp_jenis_kirim AS jenisKirim,
      h.mp_driver AS driver,
      h.mp_plat_nomor AS platNomor,
      h.mp_ekspedisi AS ekspedisi,
      h.mp_no_resi AS noResi,
      h.mp_total_sj AS totalSj,
      h.mp_total_koli AS totalKoli,
      h.mp_total_qty AS totalQty,
      h.mp_berat_kg AS beratKg,
      h.mp_ket AS keterangan,
      h.mp_status AS status,
      h.mp_ttd_pengirim AS ttdPengirim,
      h.mp_ttd_driver AS ttdDriver,
      h.user_create AS userCreate,
      h.date_create AS dateCreate
    FROM tmanifest_pengiriman_hdr h
    LEFT JOIN tgudang g ON g.gdg_kode = h.mp_gudang
    LEFT JOIN tgudang gt ON gt.gdg_kode = h.mp_tujuan
    WHERE h.mp_nomor = ?;
  `;
    const [headerRows] = await pool.query(headerQuery, [nomor]);
    if (headerRows.length === 0) {
        throw new Error("Manifest Kirim tidak ditemukan.");
    }

    const detailQuery = `
    SELECT 
      d.mpd_iddrec AS idDrec,
      d.mpd_nomor AS manifestNomor,
      d.mpd_sj_nomor AS sjNomor,
      sjh.sj_tanggal AS sjTanggal,
      d.mpd_store AS storeKode,
      g.gdg_nama AS storeNama,
      d.mpd_koli AS koli,
      d.mpd_qty AS qty,
      d.mpd_ket AS keterangan,
      d.mpd_referensi_gabung AS referensiGabung,
      sjh.sj_mt_nomor AS noMinta,
      (SELECT GROUP_CONCAT(DISTINCT pl_nomor SEPARATOR ', ') FROM tpacking_list_hdr WHERE pl_sj_nomor = d.mpd_sj_nomor) AS noPackingList
    FROM tmanifest_pengiriman_dtl d
    LEFT JOIN tdc_sj_hdr sjh ON sjh.sj_nomor = d.mpd_sj_nomor
    LEFT JOIN tgudang g ON g.gdg_kode = d.mpd_store
    WHERE d.mpd_nomor = ?
    ORDER BY d.mpd_iddrec ASC;
  `;
    const [detailRows] = await pool.query(detailQuery, [nomor]);

    return {
        header: headerRows[0],
        items: detailRows,
    };
};

/**
 * Retrieves list of Surat Jalan ready to be assigned to a Manifest.
 * Filtering: sj_manifest_nomor IS NULL/empty, sj_noterima IS NULL/empty, sj_closing <> 'Y'
 */
const getAvailableSj = async (gudang, storeSearch) => {
    let params = [];
    let whereConditions = [
        "(h.sj_manifest_nomor IS NULL OR TRIM(h.sj_manifest_nomor) = '')",
        "(h.sj_noterima IS NULL OR TRIM(h.sj_noterima) = '')",
    ];

    if (gudang && gudang.trim() !== "" && gudang !== "ALL") {
        whereConditions.push("h.sj_cab = ?");
        params.push(gudang.trim());
    }

    if (storeSearch && storeSearch.trim() !== "") {
        whereConditions.push(
            "(h.sj_nomor LIKE ? OR h.sj_kecab LIKE ? OR g.gdg_nama LIKE ? OR h.sj_mt_nomor LIKE ?)",
        );
        const pattern = `%${storeSearch.trim()}%`;
        params.push(pattern, pattern, pattern, pattern);
    }

    const query = `
    SELECT 
      h.sj_nomor AS sjNomor,
      h.sj_tanggal AS sjTanggal,
      h.sj_kecab AS storeKode,
      IFNULL(g.gdg_nama, h.sj_kecab) AS storeNama,
      h.sj_mt_nomor AS noMinta,
      h.sj_ket AS keterangan,
      IFNULL(SUM(d.sjd_jumlah), 0) AS totalQty,
      (SELECT GROUP_CONCAT(DISTINCT pl_nomor SEPARATOR ', ') FROM tpacking_list_hdr WHERE pl_sj_nomor = h.sj_nomor) AS noPackingList
    FROM tdc_sj_hdr h
    LEFT JOIN tdc_sj_dtl d ON d.sjd_nomor = h.sj_nomor
    LEFT JOIN tgudang g ON g.gdg_kode = h.sj_kecab
    WHERE ${whereConditions.join(" AND ")}
    GROUP BY h.sj_nomor, h.sj_tanggal, h.sj_kecab, g.gdg_nama, h.sj_mt_nomor, h.sj_ket
    ORDER BY h.date_create DESC, h.sj_tanggal DESC, h.sj_nomor DESC
    LIMIT 200;
  `;

    const [rows] = await pool.query(query, params);
    return rows;
};

/**
 * Saves (Create/Update) Manifest Kirim.
 */
const saveData = async (payload, user) => {
    const { header, items, isNew } = payload;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // Validasi Dasar
        if (!header.gudang) throw new Error("Gudang pengirim harus diisi.");
        if (!header.tanggal) throw new Error("Tanggal manifest harus diisi.");
        if (!items || items.length === 0)
            throw new Error("Surat Jalan yang dimuat harus diisi.");

        let totalSj = items.length;
        let totalKoli = 0;
        let totalQty = 0;

        for (const item of items) {
            if (!item.sjNomor)
                throw new Error("Nomor Surat Jalan tidak valid.");
            totalKoli += Number(item.koli || 1);
            totalQty += Number(item.qty || 0);
        }

        let manifestNomor = header.nomor;

        if (isNew) {
            manifestNomor = await generateNewManifestNumber(
                header.gudang,
                header.tanggal,
            );
            const headerSql = `
        INSERT INTO tmanifest_pengiriman_hdr (
          mp_nomor, mp_tanggal, mp_jam, mp_gudang, mp_tujuan, mp_jenis_kirim, mp_driver, 
          mp_plat_nomor, mp_ekspedisi, mp_no_resi, mp_total_sj, mp_total_koli, 
          mp_total_qty, mp_berat_kg, mp_ket, mp_status, mp_ttd_pengirim, mp_ttd_driver, user_create, date_create
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW());
      `;
            await connection.query(headerSql, [
                manifestNomor,
                header.tanggal,
                header.jam || null,
                header.gudang,
                header.tujuan || null,
                header.jenisKirim || "ARMADA_SENDIRI",
                header.driver || "",
                header.platNomor || "",
                header.ekspedisi || "",
                header.noResi || "",
                totalSj,
                totalKoli,
                totalQty,
                header.beratKg || 0,
                header.keterangan || "",
                header.status || "DIKIRIM",
                header.ttdPengirim || null,
                header.ttdDriver || null,
                user.kode || user.id || "ADMIN",
            ]);
        } else {
            // Release SJ lama yang terikat ke manifest ini
            await connection.query(
                "UPDATE tdc_sj_hdr SET sj_manifest_nomor = NULL WHERE sj_manifest_nomor = ?",
                [manifestNomor],
            );

            const headerSql = `
        UPDATE tmanifest_pengiriman_hdr SET 
          mp_tanggal = ?, mp_jam = ?, mp_gudang = ?, mp_tujuan = ?, mp_jenis_kirim = ?, 
          mp_driver = ?, mp_plat_nomor = ?, mp_ekspedisi = ?, mp_no_resi = ?, 
          mp_total_sj = ?, mp_total_koli = ?, mp_total_qty = ?, mp_berat_kg = ?, 
          mp_ket = ?, mp_status = ?, mp_ttd_pengirim = ?, mp_ttd_driver = ?, user_modified = ?, date_modified = NOW()
        WHERE mp_nomor = ?;
      `;
            await connection.query(headerSql, [
                header.tanggal,
                header.jam || null,
                header.gudang,
                header.tujuan || null,
                header.jenisKirim || "ARMADA_SENDIRI",
                header.driver || "",
                header.platNomor || "",
                header.ekspedisi || "",
                header.noResi || "",
                totalSj,
                totalKoli,
                totalQty,
                header.beratKg || 0,
                header.keterangan || "",
                header.status || "DIKIRIM",
                header.ttdPengirim || null,
                header.ttdDriver || null,
                user.kode || user.id || "ADMIN",
                manifestNomor,
            ]);

            // Hapus detail lama
            await connection.query(
                "DELETE FROM tmanifest_pengiriman_dtl WHERE mpd_nomor = ?",
                [manifestNomor],
            );
        }

        // Insert Detail baru & Update sj_manifest_nomor pada tdc_sj_hdr
        const detailSql = `
      INSERT INTO tmanifest_pengiriman_dtl (
        mpd_iddrec, mpd_nomor, mpd_sj_nomor, mpd_store, mpd_koli, mpd_qty, mpd_ket, mpd_referensi_gabung
      ) VALUES ?;
    `;

        const detailValues = items.map((item, index) => {
            const urut = index + 1;
            const iddrec = `${manifestNomor}${urut}`;
            return [
                iddrec,
                manifestNomor,
                item.sjNomor,
                item.storeKode,
                item.koli !== undefined && item.koli !== null
                    ? Number(item.koli)
                    : 1,
                item.qty || 0,
                item.keterangan || "",
                item.referensiGabung || null,
            ];
        });

        if (detailValues.length > 0) {
            await connection.query(detailSql, [detailValues]);
        }

        // Bind Surat Jalan yang dipilih ke Manifest
        const sjList = items.map((i) => i.sjNomor);
        if (sjList.length > 0) {
            await connection.query(
                "UPDATE tdc_sj_hdr SET sj_manifest_nomor = ? WHERE sj_nomor IN (?)",
                [manifestNomor, sjList],
            );
        }

        await connection.commit();
        return {
            message: `Manifest Kirim ${manifestNomor} berhasil disimpan.`,
            nomor: manifestNomor,
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

/**
 * Removes / Cancels a Manifest Kirim and releases associated Surat Jalan.
 */
const remove = async (nomor) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [headers] = await connection.query(
            "SELECT mp_status FROM tmanifest_pengiriman_hdr WHERE mp_nomor = ?",
            [nomor],
        );

        if (headers.length === 0) {
            throw new Error("Manifest Kirim tidak ditemukan.");
        }

        // Lepaskan keterikatan SJ dari Manifest ini
        await connection.query(
            "UPDATE tdc_sj_hdr SET sj_manifest_nomor = NULL WHERE sj_manifest_nomor = ?",
            [nomor],
        );

        // Hapus detail & header manifest
        await connection.query(
            "DELETE FROM tmanifest_pengiriman_dtl WHERE mpd_nomor = ?",
            [nomor],
        );
        await connection.query(
            "DELETE FROM tmanifest_pengiriman_hdr WHERE mp_nomor = ?",
            [nomor],
        );

        await connection.commit();
        return { message: `Manifest Kirim ${nomor} berhasil dihapus.` };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = {
    generateNewManifestNumber,
    getList,
    getDetails,
    getAvailableSj,
    saveData,
    remove,
};
