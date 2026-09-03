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
    const { startDate, endDate, gudang, tujuan, status, search } = filters;
    let params = [startDate, endDate];
    let whereConditions = ["h.mp_tanggal BETWEEN ? AND ?"];

    if (gudang && gudang !== "") {
        whereConditions.push("h.mp_gudang = ?");
        params.push(gudang);
    }

    if (tujuan && tujuan !== "") {
        whereConditions.push("h.mp_tujuan = ?");
        params.push(tujuan);
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
      gt.gdg_nama AS NamaTujuan,
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
      h.date_create AS DateCreate,
      CASE WHEN h.mp_ttd_pengirim IS NOT NULL AND h.mp_ttd_pengirim != '' THEN 'Y' ELSE 'N' END AS HasTtdPengirim,
      CASE WHEN h.mp_ttd_driver IS NOT NULL AND h.mp_ttd_driver != '' THEN 'Y' ELSE 'N' END AS HasTtdDriver
    FROM tmanifest_pengiriman_hdr h
    LEFT JOIN tgudang g ON g.gdg_kode = h.mp_gudang
    LEFT JOIN tgudang gt ON gt.gdg_kode = h.mp_tujuan
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
      h.date_create AS dateCreate,
      h.user_modified AS userModified,
      h.date_modified AS dateModified
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
      d.mpd_nama_barang AS namaBarang,
      CASE 
        WHEN d.mpd_nama_barang IS NOT NULL AND TRIM(d.mpd_nama_barang) != '' THEN 'Barang Lain-lain' 
        ELSE 'Barang SJ' 
      END AS kategori,
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

        // 1. Validasi & Sinkronisasi Tujuan Pengiriman (Store Tujuan)
        const sjItems = items.filter(
            (i) => i.sjNomor && String(i.sjNomor).trim() !== "",
        );

        if (sjItems.length > 0) {
            const primaryStore = String(sjItems[0].storeKode || "")
                .trim()
                .toUpperCase();
            if (!primaryStore) {
                throw new Error(
                    `Surat Jalan ${sjItems[0].sjNomor} tidak memiliki kode toko tujuan.`,
                );
            }

            // Pastikan semua SJ dalam manifest menuju ke toko yang sama
            for (const sj of sjItems) {
                const curStore = String(sj.storeKode || "")
                    .trim()
                    .toUpperCase();
                if (curStore !== primaryStore) {
                    throw new Error(
                        `Surat Jalan ${sj.sjNomor} bertujuan ke "${curStore}", tidak sama dengan tujuan manifest (${primaryStore}). Semua SJ dalam satu manifest harus menuju ke store yang sama.`,
                    );
                }
            }

            // Selaraskan header.tujuan dengan store tujuan SJ
            header.tujuan = primaryStore;
        } else {
            if (!header.tujuan || String(header.tujuan).trim() === "") {
                throw new Error("Tujuan pengiriman manifest harus diisi.");
            }
            header.tujuan = String(header.tujuan).trim().toUpperCase();
        }

        // Pastikan semua item muatan (SJ maupun custom) memiliki storeKode yang sama dengan header.tujuan
        for (const item of items) {
            item.storeKode = header.tujuan;
        }

        let totalSj = 0;
        let totalKoli = 0;
        let totalQty = 0;

        for (const item of items) {
            const hasSj = item.sjNomor && String(item.sjNomor).trim() !== "";
            const hasNama =
                item.namaBarang && String(item.namaBarang).trim() !== "";
            if (!hasSj && !hasNama) {
                throw new Error(
                    "Setiap item muatan harus memiliki Nomor Surat Jalan atau Nama Barang.",
                );
            }
            if (hasSj) {
                totalSj++;
            }
            const koliVal =
                item.koli !== undefined &&
                item.koli !== null &&
                !isNaN(Number(item.koli))
                    ? Number(item.koli)
                    : 0;
            totalKoli += koliVal;
            totalQty += Number(item.qty || 0);
        }

        let manifestNomor = header.nomor;

        const hasBothTtd = Boolean(header.ttdPengirim && header.ttdDriver);
        const finalStatus = header.status || (hasBothTtd ? "DIKIRIM" : "DRAFT");

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
                header.jenisKirim || null,
                header.driver || "",
                header.platNomor || "",
                header.ekspedisi || "",
                header.noResi || "",
                totalSj,
                totalKoli,
                totalQty,
                header.beratKg || 0,
                header.keterangan || "",
                finalStatus,
                header.ttdPengirim || null,
                header.ttdDriver || null,
                user.kode || user.id || "ADMIN",
            ]);
        } else {
            // Cek status tanda tangan dan status manifest yang sudah ada di database
            const [existingRows] = await connection.query(
                "SELECT mp_jenis_kirim, mp_status, mp_ttd_pengirim, mp_ttd_driver FROM tmanifest_pengiriman_hdr WHERE mp_nomor = ?",
                [manifestNomor],
            );

            if (existingRows.length === 0) {
                throw new Error("Manifest Kirim tidak ditemukan.");
            }

            const existing = existingRows[0];
            const hasSignedBoth = Boolean(
                existing.mp_ttd_pengirim &&
                String(existing.mp_ttd_pengirim).trim() !== "" &&
                existing.mp_ttd_driver &&
                String(existing.mp_ttd_driver).trim() !== "",
            );
            const isDikirimOrDone = ["DIKIRIM", "SELESAI", "TERKIRIM"].includes(
                String(existing.mp_status || "").toUpperCase(),
            );
            const isLocked = hasSignedBoth || isDikirimOrDone;

            if (isLocked) {
                if (existing.mp_jenis_kirim === "EKSPEDISI") {
                    // Khusus EKSPEDISI: Hanya boleh memperbarui No. Resi saja
                    await connection.query(
                        "UPDATE tmanifest_pengiriman_hdr SET mp_no_resi = ?, user_modified = ?, date_modified = NOW() WHERE mp_nomor = ?",
                        [
                            header.noResi || "",
                            user.kode || user.id || "ADMIN",
                            manifestNomor,
                        ],
                    );
                    await connection.commit();
                    return {
                        message: `No. Resi untuk Manifest ${manifestNomor} berhasil diperbarui.`,
                        nomor: manifestNomor,
                    };
                } else {
                    throw new Error(
                        "Manifest sudah dikirim / ditandatangani oleh pengirim dan penerima. Perubahan data tidak diizinkan.",
                    );
                }
            }

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
                header.jenisKirim || null,
                header.driver || "",
                header.platNomor || "",
                header.ekspedisi || "",
                header.noResi || "",
                totalSj,
                totalKoli,
                totalQty,
                header.beratKg || 0,
                header.keterangan || "",
                finalStatus,
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
        mpd_iddrec, mpd_nomor, mpd_sj_nomor, mpd_nama_barang, mpd_store, mpd_koli, mpd_qty, mpd_ket, mpd_referensi_gabung
      ) VALUES ?;
    `;

        const detailValues = items.map((item, index) => {
            const urut = index + 1;
            const iddrec = `${manifestNomor}${urut}`;
            const koliVal =
                item.koli !== undefined &&
                item.koli !== null &&
                !isNaN(Number(item.koli))
                    ? Number(item.koli)
                    : 0;
            return [
                iddrec,
                manifestNomor,
                item.sjNomor && String(item.sjNomor).trim() !== ""
                    ? String(item.sjNomor).trim()
                    : null,
                item.namaBarang && String(item.namaBarang).trim() !== ""
                    ? String(item.namaBarang).trim()
                    : null,
                item.storeKode,
                koliVal,
                item.qty || 0,
                item.keterangan || "",
                item.referensiGabung || null,
            ];
        });

        if (detailValues.length > 0) {
            await connection.query(detailSql, [detailValues]);
        }

        // Bind Surat Jalan yang dipilih ke Manifest (hanya yang memiliki nomor SJ)
        const sjList = items
            .filter((i) => i.sjNomor && String(i.sjNomor).trim() !== "")
            .map((i) => String(i.sjNomor).trim());
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

/**
 * Updates only the status field of a Manifest Kirim.
 * Allowed transitions: any -> DIKIRIM (manual confirm by admin)
 */
const updateStatus = async (nomor, newStatus, user) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [rows] = await connection.query(
            "SELECT mp_status FROM tmanifest_pengiriman_hdr WHERE mp_nomor = ?",
            [nomor],
        );

        if (rows.length === 0) {
            throw new Error("Manifest Kirim tidak ditemukan.");
        }

        const allowedTargets = ["DIKIRIM", "SELESAI", "BATAL"];
        if (!allowedTargets.includes(newStatus)) {
            throw new Error(`Status "${newStatus}" tidak diizinkan.`);
        }

        await connection.query(
            "UPDATE tmanifest_pengiriman_hdr SET mp_status = ?, user_modified = ?, date_modified = NOW() WHERE mp_nomor = ?",
            [newStatus, user?.kode || user?.id || "SYSTEM", nomor],
        );

        await connection.commit();
        return {
            message: `Status Manifest ${nomor} berhasil diubah ke ${newStatus}.`,
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

/**
 * Mengambil data detail lengkap (Header + Detail SJ) Manifest Pengiriman untuk export Excel.
 */
const exportDetails = async (filters) => {
    const { startDate, endDate, gudang, tujuan, status, search } = filters;
    let params = [startDate, endDate];
    let whereConditions = ["h.mp_tanggal BETWEEN ? AND ?"];

    if (gudang && gudang !== "") {
        whereConditions.push("h.mp_gudang = ?");
        params.push(gudang);
    }

    if (tujuan && tujuan !== "") {
        whereConditions.push("h.mp_tujuan = ?");
        params.push(tujuan);
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
      h.mp_nomor AS 'Nomor Manifest',
      h.mp_tanggal AS 'Tanggal',
      h.mp_jam AS 'Jam',
      h.mp_status AS 'Status',
      g.gdg_nama AS 'Gudang Pengirim',
      IFNULL(gt.gdg_nama, h.mp_tujuan) AS 'Tujuan Manifest',
      h.mp_jenis_kirim AS 'Jenis Kirim',
      h.mp_driver AS 'Driver',
      h.mp_plat_nomor AS 'Plat Nomor',
      h.mp_ekspedisi AS 'Ekspedisi',
      h.mp_no_resi AS 'No Resi',
      d.mpd_sj_nomor AS 'Nomor SJ',
      sjh.sj_tanggal AS 'Tanggal SJ',
      d.mpd_store AS 'Kode Store SJ',
      gs.gdg_nama AS 'Nama Store SJ',
      sjh.sj_mt_nomor AS 'No Minta Barang',
      d.mpd_koli AS 'Jml Koli',
      d.mpd_qty AS 'Qty',
      d.mpd_nama_barang AS 'Item / Barang',
      CASE 
        WHEN d.mpd_nama_barang IS NOT NULL AND TRIM(d.mpd_nama_barang) != '' THEN 'Barang Lain-lain' 
        ELSE 'Barang SJ' 
      END AS 'Kategori',
      d.mpd_ket AS 'Keterangan SJ',
      h.user_create AS 'User Create'
    FROM tmanifest_pengiriman_hdr h
    INNER JOIN tmanifest_pengiriman_dtl d ON d.mpd_nomor = h.mp_nomor
    LEFT JOIN tgudang g ON g.gdg_kode = h.mp_gudang
    LEFT JOIN tgudang gt ON gt.gdg_kode = h.mp_tujuan
    LEFT JOIN tgudang gs ON gs.gdg_kode = d.mpd_store
    LEFT JOIN tdc_sj_hdr sjh ON sjh.sj_nomor = d.mpd_sj_nomor
    WHERE ${whereConditions.join(" AND ")}
    ORDER BY h.mp_tanggal DESC, h.mp_nomor DESC, d.mpd_iddrec ASC;
  `;

    const [rows] = await pool.query(query, params);
    return rows;
};

module.exports = {
    generateNewManifestNumber,
    getList,
    getDetails,
    getAvailableSj,
    saveData,
    remove,
    updateStatus,
    exportDetails,
};
