const pool = require("../config/database");

// --- [TAMBAHAN] Helper untuk generate IDREC ---
const generateIdRec = (cabang) => {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");

  // Gunakan 'MST' untuk Mutasi Terima (agar beda dengan MSK)
  // Format: K08MST20251204155447.134
  return `${cabang}MST${yyyy}${mm}${dd}${hh}${min}${ss}.${ms}`;
};

// Fungsi untuk memuat data dari dokumen pengiriman
const loadFromKirim = async (nomorKirim) => {
  const query = `
    SELECT 
        MAX(h.msk_nomor) AS msk_nomor, MAX(h.msk_tanggal) AS msk_tanggal, MAX(h.msk_ket) AS msk_ket,
        MAX(h.msk_cab) AS gudangAsalKode,
        MAX(g.gdg_nama) AS gudangAsalNama,
        d.mskd_kode AS kode,
        MAX(b.brgd_barcode) AS barcode,
        MAX(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna))) AS nama,
        d.mskd_ukuran AS ukuran,
        SUM(d.mskd_jumlah) AS jumlahKirim
    FROM tmsk_hdr h
    INNER JOIN tmsk_dtl d ON d.mskd_nomor = h.msk_nomor
    LEFT JOIN tbarangdc a ON a.brg_kode = d.mskd_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.mskd_kode AND b.brgd_ukuran = d.mskd_ukuran
    LEFT JOIN tgudang g ON g.gdg_kode = h.msk_cab
    WHERE h.msk_nomor = ?
    GROUP BY d.mskd_kode, d.mskd_ukuran;
    `;
  const [rows] = await pool.query(query, [nomorKirim]);
  if (rows.length === 0) throw new Error("Dokumen pengiriman tidak ditemukan.");

  const header = {
    nomorKirim: rows[0].msk_nomor,
    tanggalKirim: rows[0].msk_tanggal,
    gudangAsalKode: rows[0].gudangAsalKode,
    gudangAsalNama: rows[0].gudangAsalNama,
    keterangan: rows[0].msk_ket,
  };
  const items = rows.map((row) => ({
    kode: row.kode,
    barcode: row.barcode,
    nama: row.nama,
    ukuran: row.ukuran,
    jumlahKirim: row.jumlahKirim,
  }));
  return { header, items };
};

// Fungsi untuk menyimpan data penerimaan
const save = async (payload, user) => {
  const { header, items } = payload;

  if (!items || items.length === 0) {
    throw new Error("Tidak dapat menyimpan: Daftar barang kosong!");
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const year = new Date(header.tanggalTerima)
      .getFullYear()
      .toString()
      .substring(2);
    const prefix = `${user.cabang}.MST.${year}`;
    const nomorQuery = `SELECT IFNULL(MAX(RIGHT(mst_nomor, 5)), 0) + 1 AS next_num FROM tmst_hdr WHERE LEFT(mst_nomor, 10) = ?;`;
    const [nomorRows] = await connection.query(nomorQuery, [prefix]);
    const nextNum = nomorRows[0].next_num.toString().padStart(5, "0");
    const nomorTerima = `${prefix}${nextNum}`;

    const currentIdRec = generateIdRec(user.cabang);

    const headerInsertQuery = `
        INSERT INTO tmst_hdr (
            mst_nomor, mst_tanggal, 
            mst_cab, mst_idrec, 
            user_create, date_create
        )
        VALUES (?, ?, ?, ?, ?, NOW());
    `;
    await connection.query(headerInsertQuery, [
      nomorTerima,
      header.tanggalTerima,
      user.cabang,
      currentIdRec,
      user.kode,
    ]);

    await connection.query(
      "UPDATE tmsk_hdr SET msk_noterima = ? WHERE msk_nomor = ?",
      [nomorTerima, header.nomorKirim],
    );

    const receivedSerials = [];

    if (items.length > 0) {
      const itemValues = [];
      let rowCounter = 0;

      for (const item of items) {
        const qty = Number(item.jumlahTerima) || 0;
        if (qty <= 0) continue;

        // BARU: cari unit_serial spesifik yang dikirim lewat dokumen
        // MSK ini (bukan pool TRANSIT_ANTAR_STORE global)
        const [candidateRows] = await connection.query(
          `SELECT mskd_unit_serial FROM tmsk_dtl
           WHERE mskd_nomor = ? AND mskd_kode = ? AND mskd_ukuran = ?
             AND mskd_unit_serial IS NOT NULL
           ORDER BY mskd_unit_serial ASC
           LIMIT ? FOR UPDATE`,
          [header.nomorKirim, item.kode, item.ukuran, qty],
        );
        const pickedSerials = candidateRows.map((r) => r.mskd_unit_serial);

        for (const serial of pickedSerials) {
          rowCounter++;
          const iddrec = `${currentIdRec}${rowCounter}`;
          itemValues.push([
            currentIdRec,
            iddrec,
            nomorTerima,
            item.kode,
            item.ukuran,
            1,
            serial,
          ]);
          receivedSerials.push(serial);
        }

        const sisaQty = qty - pickedSerials.length;
        if (sisaQty > 0) {
          rowCounter++;
          const iddrec = `${currentIdRec}${rowCounter}`;
          itemValues.push([
            currentIdRec,
            iddrec,
            nomorTerima,
            item.kode,
            item.ukuran,
            sisaQty,
            null,
          ]);
        }
      }

      if (itemValues.length > 0) {
        const itemInsertQuery = `
          INSERT INTO tmst_dtl (
              mstd_idrec, mstd_iddrec, 
              mstd_nomor, mstd_kode, mstd_ukuran, mstd_jumlah, mstd_unit_serial
          ) VALUES ?;
        `;
        await connection.query(itemInsertQuery, [itemValues]);
      }
    }

    if (receivedSerials.length > 0) {
      await connection.query(
        `UPDATE tbarangdc_unit SET unit_status = 'DI_TOKO', unit_lokasi_saat_ini = ?,
           date_modified = NOW(), user_modified = ?
         WHERE unit_serial IN (?)`,
        [user.cabang, user.kode, receivedSerials],
      );
    }

    await connection.commit();
    return {
      message: `Penerimaan berhasil disimpan dengan nomor ${nomorTerima}`,
      nomor: nomorTerima,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { loadFromKirim, save };
