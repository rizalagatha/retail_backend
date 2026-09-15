const pool = require("../config/database");
const { format } = require("date-fns");

const loadAllStock = async (cabang) => {
  const query = `
    SELECT 
      x.kode, x.ukuran, x.stok,
      b.brgd_barcode AS barcode,
      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama
    FROM (
      SELECT mst_brg_kode AS kode, mst_ukuran AS ukuran, SUM(mst_stok_in - mst_stok_out) AS stok 
      FROM tmasterstok
      WHERE mst_aktif = 'Y' AND mst_cab = ?
      GROUP BY mst_brg_kode, mst_ukuran
    ) x
    LEFT JOIN tbarangdc a ON a.brg_kode = x.kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = x.kode AND b.brgd_ukuran = x.ukuran
    WHERE x.stok <> 0;
  `;
  const [rows] = await pool.query(query, [cabang]);
  return rows;
};

const getForEdit = async (nomor) => {
  const headerQuery = `
    SELECT 
      rb_nomor AS nomor,
      rb_tanggal AS tanggal,
      rb_cab,
      rb_kecab,
      g1.gdg_nama AS asal_nama,
      g2.gdg_nama AS tujuan_nama,
      rb_ket AS keterangan
    FROM trbdc_hdr h
    LEFT JOIN tgudang g1 ON g1.gdg_kode = h.rb_cab
    LEFT JOIN tgudang g2 ON g2.gdg_kode = h.rb_kecab
    WHERE rb_nomor = ?
  `;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0) throw new Error("Dokumen tidak ditemukan.");

  // [FIX] Gunakan headerRows[0] alih-alih variabel 'row' yang tidak didefinisikan
  const row = headerRows[0];
  const header = {
    nomor: row.nomor,
    tanggal: row.tanggal,
    gudangAsal: { kode: row.rb_cab, nama: row.asal_nama },
    // Pastikan ini objek {kode, nama} agar sinkron dengan v-model di frontend
    gudangDc: { kode: row.rb_kecab, nama: row.tujuan_nama },
    keterangan: row.keterangan,
  };

  const gudangAsal = row.rb_cab;
  const itemsQuery = `
    SELECT
      d.rbd_kode AS kode,
      MAX(b.brgd_barcode) AS barcode,
      MAX(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna))) AS nama,
      d.rbd_ukuran AS ukuran,
      SUM(d.rbd_jumlah) AS jumlah,
      (IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif='Y' AND m.mst_cab=? AND m.mst_brg_kode=d.rbd_kode AND m.mst_ukuran=d.rbd_ukuran), 0) + SUM(d.rbd_jumlah)) AS stok
    FROM trbdc_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.rbd_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.rbd_kode AND b.brgd_ukuran = d.rbd_ukuran
    WHERE d.rbd_nomor = ?
    GROUP BY d.rbd_kode, d.rbd_ukuran
    ORDER BY MIN(d.rbd_iddrec) ASC`;

  const [items] = await pool.query(itemsQuery, [gudangAsal, nomor]);

  return { header, items };
};

const getProductDetails = async (filters) => {
  const { kode, ukuran, gudang } = filters;
  const query = `
    SELECT 
      b.brgd_kode AS kode, b.brgd_barcode AS barcode,
      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
      b.brgd_ukuran AS ukuran,
        IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=? AND m.mst_ukuran=?), 0) AS stok
      FROM tbarangdc_dtl b
      INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
      WHERE a.brg_aktif = 0 AND b.brgd_kode = ? AND b.brgd_ukuran = ?;
    `;
  const [rows] = await pool.query(query, [gudang, kode, ukuran, kode, ukuran]);
  if (rows.length === 0) throw new Error("Detail produk tidak ditemukan");
  return rows[0];
};

const findByBarcode = async (barcode, gudang) => {
  const query = `
    SELECT 
      b.brgd_kode AS kode, b.brgd_barcode AS barcode,
      TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
      b.brgd_ukuran AS ukuran,
      IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=b.brgd_kode AND m.mst_ukuran=b.brgd_ukuran), 0) AS stok
    FROM tbarangdc_dtl b
    INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
    WHERE a.brg_aktif = 0 AND b.brgd_barcode = ?;
  `;
  const [rows] = await pool.query(query, [gudang, barcode]);
  if (rows.length === 0) throw new Error("Barcode tidak ditemukan.");
  return rows[0];
};

const save = async (payload, user) => {
  const { header, items, isNew } = payload;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    let nomorDokumen = header.nomor;

    // Generate IDREC Header (Format: K01RB + Timestamp)
    // Gunakan format timestamp presisi milidetik agar unik
    const idrecHeader = isNew
      ? `${user.cabang}RB${format(new Date(), "yyyyMMddHHmmssSSS")}`
      : (
          await connection.query(
            "SELECT rb_idrec FROM trbdc_hdr WHERE rb_nomor = ?",
            [nomorDokumen],
          )
        )[0][0]?.rb_idrec;

    // --- LOGIC INSERT BARU ---
    if (isNew) {
      const yearMonth = new Date(header.tanggal)
        .toISOString()
        .slice(2, 7) // "23-10"
        .replace("-", ""); // "2310"

      const prefix = `${user.cabang}.RB.${yearMonth}.`;

      // [FIX] Gunakan FOR UPDATE untuk locking
      const nomorQuery = `
        SELECT IFNULL(MAX(CAST(RIGHT(rb_nomor, 4) AS UNSIGNED)), 0) + 1 AS next_num 
        FROM trbdc_hdr 
        WHERE rb_nomor LIKE ? 
        FOR UPDATE;
      `;

      const [nomorRows] = await connection.query(nomorQuery, [`${prefix}%`]);
      const nextNum = nomorRows[0].next_num;

      nomorDokumen = `${prefix}${nextNum.toString().padStart(4, "0")}`;

      // Insert Header dengan IDREC
      await connection.query(
        `INSERT INTO trbdc_hdr 
          (rb_idrec, rb_nomor, rb_tanggal, rb_cab, rb_kecab, rb_ket, user_create, date_create) 
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          idrecHeader, // [BARU] Masukkan IDREC Header
          nomorDokumen,
          header.tanggal,
          user.cabang,
          header.gudangDc.kode,
          header.keterangan,
          user.kode,
        ],
      );

      // --- LOGIC UPDATE (EDIT) ---
    } else {
      const [checkRows] = await connection.query(
        "SELECT rb_nomor FROM trbdc_hdr WHERE rb_nomor = ? FOR UPDATE",
        [nomorDokumen],
      );

      if (checkRows.length === 0) {
        throw new Error(
          `Dokumen ${nomorDokumen} tidak ditemukan atau sudah dihapus.`,
        );
      }

      await connection.query(
        `UPDATE trbdc_hdr 
          SET rb_tanggal = ?, rb_cab = ?, rb_kecab = ?, rb_ket = ?, 
            user_modified = ?, date_modified = NOW()
          WHERE rb_nomor = ?`,
        [
          header.tanggal,
          user.cabang,
          header.gudangDc.kode,
          header.keterangan,
          user.kode,
          nomorDokumen,
        ],
      );

      // BARU: mode edit — kembalikan status unit lama sebelum
      // detailnya diganti, supaya tidak nyangkut di DI_DC kalau
      // barisnya dihapus/diubah saat edit
      const [oldSerials] = await connection.query(
        `SELECT rbd_unit_serial FROM trbdc_dtl WHERE rbd_nomor = ? AND rbd_unit_serial IS NOT NULL`,
        [nomorDokumen],
      );
      if (oldSerials.length > 0) {
        await connection.query(
          `UPDATE tbarangdc_unit SET unit_status = 'DI_TOKO' WHERE unit_serial IN (?)`,
          [oldSerials.map((r) => r.rbd_unit_serial)],
        );
      }

      // Hapus detail lama
      await connection.query("DELETE FROM trbdc_dtl WHERE rbd_nomor = ?", [
        nomorDokumen,
      ]);
    }

    // --- INSERT DETAIL ITEMS ---
    if (items.length > 0) {
      const itemValues = [];
      const movedSerials = [];
      let rowCounter = 0;

      for (const item of items) {
        const qty = Number(item.jumlah) || 0;
        if (qty <= 0) continue;

        let pickedSerials = [];

        // Kasus 1: baris bawa unitSerial tunggal (scan QR langsung)
        if (item.unitSerial) {
          pickedSerials = [item.unitSerial];
        }
        // Kasus 2: baris dari "Ambil dari Retur Online" — sudah bawa
        // daftar unit_serial spesifik dari dokumen retur jual itu
        else if (item.unitSerials && item.unitSerials.length > 0) {
          pickedSerials = item.unitSerials.slice(0, qty);
        }
        // Kasus 3: baris manual (F1/F2/scan barcode lama) — FIFO-pick
        // dari pool showroom, soft fallback
        else {
          const [rows] = await connection.query(
            `SELECT unit_serial FROM tbarangdc_unit
             WHERE unit_kode = ? AND unit_ukuran = ? AND unit_status = 'DI_TOKO' AND unit_lokasi_saat_ini = ?
             ORDER BY date_create ASC, unit_serial ASC
             LIMIT ? FOR UPDATE`,
            [item.kode, item.ukuran, user.cabang, qty],
          );
          pickedSerials = rows.map((r) => r.unit_serial);
        }

        for (const serial of pickedSerials) {
          rowCounter++;
          const idrecDetail = `${idrecHeader}.${String(rowCounter).padStart(3, "0")}`;
          itemValues.push([
            idrecHeader,
            idrecDetail,
            nomorDokumen,
            item.kode,
            item.ukuran,
            1,
            serial,
          ]);
          movedSerials.push(serial);
        }

        const sisaQty = qty - pickedSerials.length;
        if (sisaQty > 0) {
          rowCounter++;
          const idrecDetail = `${idrecHeader}.${String(rowCounter).padStart(3, "0")}`;
          itemValues.push([
            idrecHeader,
            idrecDetail,
            nomorDokumen,
            item.kode,
            item.ukuran,
            sisaQty,
            null,
          ]);
        }
      }

      if (itemValues.length > 0) {
        await connection.query(
          `INSERT INTO trbdc_dtl (rbd_idrec, rbd_iddrec, rbd_nomor, rbd_kode, rbd_ukuran, rbd_jumlah, rbd_unit_serial) VALUES ?`,
          [itemValues],
        );
      }

      if (movedSerials.length > 0) {
        await connection.query(
          `UPDATE tbarangdc_unit SET unit_status = 'DI_DC', unit_lokasi_saat_ini = ?,
             date_modified = NOW(), user_modified = ?
           WHERE unit_serial IN (?)`,
          [header.gudangDc.kode, user.kode, movedSerials],
        );
      }
    }

    await connection.commit();

    return {
      message: `Retur Barang ke DC berhasil disimpan dengan nomor ${nomorDokumen}`,
      nomor: nomorDokumen,
    };
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") {
      throw new Error(
        "Terjadi duplikasi nomor dokumen. Silakan coba simpan kembali.",
      );
    }
    throw error;
  } finally {
    connection.release();
  }
};

const lookupGudangDc = async (filters) => {
  const { term, page: pageStr, itemsPerPage: itemsPerPageStr } = filters;
  const page = parseInt(pageStr, 10) || 1;
  const itemsPerPage = parseInt(itemsPerPageStr, 10) || 10;
  const offset = (page - 1) * itemsPerPage;
  const searchTerm = `%${term || ""}%`;

  let whereConditions = ["gdg_dc = 1"]; // <-- Logika utama: hanya gudang DC
  let params = [];

  if (term) {
    whereConditions.push(`(gdg_kode LIKE ? OR gdg_nama LIKE ?)`);
    params.push(searchTerm, searchTerm);
  }

  const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

  const countQuery = `SELECT COUNT(*) as total FROM tgudang ${whereClause}`;
  const [countRows] = await pool.query(countQuery, params);
  const total = countRows[0].total;

  const dataQuery = `
    SELECT gdg_kode AS kode, gdg_nama AS nama 
    FROM tgudang 
    ${whereClause}
    ORDER BY gdg_kode
    LIMIT ? OFFSET ?;
  `;
  const dataParams = [...params, itemsPerPage, offset];
  const [items] = await pool.query(dataQuery, dataParams);

  return { items, total };
};

const getPrintData = async (nomor) => {
  const query = `
    SELECT 
      MAX(h.rb_nomor) AS rb_nomor, MAX(h.rb_tanggal) AS rb_tanggal,
      MAX(h.rb_ket) AS rb_ket, MAX(h.rb_cab) AS rb_cab,
      MAX(DATE_FORMAT(h.date_create, '%d-%m-%Y %H:%i:%s')) AS created,
      MAX(h.user_create) AS user_create,
      d.rbd_kode,
      MAX(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna))) AS nama_barang,
      d.rbd_ukuran,
      SUM(d.rbd_jumlah) AS rbd_jumlah,
      MAX(g_asal.gdg_nama) AS dari_gudang,
      MAX(g_tujuan.gdg_nama) AS ke_gudang,
      MAX(g_asal.gdg_inv_nama) AS gdg_inv_nama,
      MAX(g_asal.gdg_inv_alamat) AS gdg_inv_alamat,
      MAX(g_asal.gdg_inv_kota) AS gdg_inv_kota,
      MAX(g_asal.gdg_inv_telp) AS gdg_inv_telp
    FROM trbdc_hdr h
    LEFT JOIN trbdc_dtl d ON d.rbd_nomor = h.rb_nomor
    LEFT JOIN tgudang g_asal ON g_asal.gdg_kode = h.rb_cab
    LEFT JOIN tgudang g_tujuan ON g_tujuan.gdg_kode = h.rb_kecab
    LEFT JOIN tbarangdc a ON a.brg_kode = d.rbd_kode
    WHERE h.rb_nomor = ?
    GROUP BY d.rbd_kode, d.rbd_ukuran;
  `;
  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) throw new Error("Data untuk dicetak tidak ditemukan.");

  const header = {
    nomor: rows[0].rb_nomor,
    tanggal: rows[0].rb_tanggal,
    keterangan: rows[0].rb_ket,
    created: rows[0].created,
    user_create: rows[0].user_create,
    dariStore: rows[0].dari_gudang,
    keGudang: rows[0].ke_gudang,
    perush_nama: rows[0].gdg_inv_nama,
    perush_alamat: `${rows[0].gdg_inv_alamat || ""}, ${rows[0].gdg_inv_kota || ""}`,
    perush_telp: rows[0].gdg_inv_telp,
  };
  const details = rows
    .filter((r) => r.rbd_kode)
    .map((r) => ({
      kode: r.rbd_kode,
      nama: r.nama_barang,
      ukuran: r.rbd_ukuran,
      jumlah: r.rbd_jumlah,
    }));

  return { header, details };
};

const lookupReturJualKON = async (cabang) => {
  // Hanya mencari retur jenis 'O' (Online) untuk cabang yang bersangkutan
  const query = `
    SELECT 
        rj_nomor AS Nomor, 
        rj_tanggal AS Tanggal, 
        rj_inv AS Invoice,
        (SELECT SUM(rjd_jumlah) FROM trj_dtl WHERE rjd_nomor = h.rj_nomor) AS Qty
    FROM trj_hdr h
    WHERE rj_cab = ? 
      AND rj_jenis = 'O'
      AND rj_nomor NOT IN (SELECT IFNULL(rb_ket, '') FROM trbdc_hdr WHERE rb_cab = ?)
    ORDER BY rj_nomor DESC;
  `;
  const [rows] = await pool.query(query, [cabang, cabang]);
  return rows;
};

const getItemsFromReturJual = async (nomorRetur, cabang) => {
  const query = `
    SELECT 
        d.rjd_kode AS kode,
        d.rjd_ukuran AS ukuran,
        SUM(d.rjd_jumlah) AS jumlah,
        MAX(b.brgd_barcode) AS barcode,
        MAX(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna))) AS nama,
        IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif='Y' AND m.mst_cab=? AND m.mst_brg_kode=d.rjd_kode AND m.mst_ukuran=d.rjd_ukuran), 0) AS stok
    FROM trj_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.rjd_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.rjd_kode AND b.brgd_ukuran = d.rjd_ukuran
    WHERE d.rjd_nomor = ?
    GROUP BY d.rjd_kode, d.rjd_ukuran;
  `;
  const [rows] = await pool.query(query, [cabang, nomorRetur]);

  // BARU: ambil daftar unit_serial spesifik per kode+ukuran (kalau
  // ada) — supaya Retur ke DC mindahin unit yang PERSIS sama, bukan
  // tebakan FIFO
  const [serialRows] = await pool.query(
    `SELECT rjd_kode, rjd_ukuran, rjd_unit_serial
     FROM trj_dtl
     WHERE rjd_nomor = ? AND rjd_unit_serial IS NOT NULL`,
    [nomorRetur],
  );
  const serialMap = new Map();
  for (const r of serialRows) {
    const key = `${r.rjd_kode}|${r.rjd_ukuran}`;
    if (!serialMap.has(key)) serialMap.set(key, []);
    serialMap.get(key).push(r.rjd_unit_serial);
  }

  return rows.map((row) => ({
    ...row,
    unitSerials: serialMap.get(`${row.kode}|${row.ukuran}`) || [],
  }));
};

const findUnitForReturDc = async (serial, cabang) => {
  const [unitRows] = await pool.query(
    `SELECT unit_serial, unit_kode, unit_ukuran, unit_status, unit_lokasi_saat_ini
     FROM tbarangdc_unit WHERE unit_serial = ?`,
    [serial],
  );
  if (unitRows.length === 0) {
    const err = new Error("QR tidak dikenali.");
    err.statusCode = 404;
    throw err;
  }
  const unit = unitRows[0];
  if (unit.unit_status !== "DI_TOKO") {
    throw new Error(
      `Unit ini berstatus '${unit.unit_status}', bukan stok showroom.`,
    );
  }
  if (unit.unit_lokasi_saat_ini && unit.unit_lokasi_saat_ini !== cabang) {
    throw new Error(
      `Unit ini tercatat di cabang ${unit.unit_lokasi_saat_ini}, bukan cabang Anda.`,
    );
  }

  const [detail] = await pool.query(
    `SELECT
       TRIM(CONCAT(h.brg_jeniskaos," ",h.brg_tipe," ",h.brg_lengan," ",h.brg_jeniskain," ",h.brg_warna)) AS nama,
       d.brgd_barcode AS barcode
     FROM tbarangdc_dtl d
     LEFT JOIN tbarangdc h ON h.brg_kode = d.brgd_kode
     WHERE d.brgd_kode = ? AND d.brgd_ukuran = ?`,
    [unit.unit_kode, unit.unit_ukuran],
  );

  return {
    unitSerial: unit.unit_serial,
    kode: unit.unit_kode,
    ukuran: unit.unit_ukuran,
    nama: detail[0]?.nama || "",
    barcode: detail[0]?.barcode || "",
  };
};

module.exports = {
  loadAllStock,
  save,
  getForEdit,
  getProductDetails,
  findByBarcode,
  lookupGudangDc,
  getPrintData,
  lookupReturJualKON,
  getItemsFromReturJual,
  findUnitForReturDc,
};
