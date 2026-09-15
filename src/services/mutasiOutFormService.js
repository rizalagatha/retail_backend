const pool = require("../config/database");
const { format } = require("date-fns");

/**
 * @description Helper function dari Delphi 'getsudah'.
 */
const getSudah = async (connection, soNomor, kode, ukuran, excludeMoNomor) => {
  const query = `
        SELECT IFNULL(SUM(mod_jumlah), 0) AS total 
        FROM tmutasiout_dtl
        JOIN tmutasiout_hdr ON mo_nomor = mod_nomor
        WHERE mo_nomor <> ? AND mo_so_nomor = ? AND mod_kode = ? AND mod_ukuran = ?
    `;
  const [rows] = await connection.query(query, [
    excludeMoNomor || "",
    soNomor,
    kode,
    ukuran,
  ]);
  return rows[0].total;
};

/**
 * @description Mencari SO yang valid untuk diinput (form bantuan F1).
 */
const searchSo = async (filters, user) => {
  const { term, page = 1, itemsPerPage = 10 } = filters;
  const searchTerm = `%${term}%`;
  const offset = (page - 1) * itemsPerPage;

  const countQuery = `
    SELECT COUNT(*) as total FROM (
        SELECT h.so_nomor
        FROM tso_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
        WHERE h.so_aktif = "Y" AND h.so_close = 0 AND so_cab = ?
            AND (h.so_nomor LIKE ? OR c.cus_nama LIKE ?)
            AND IFNULL((SELECT SUM(dd.invd_jumlah) FROM tinv_dtl dd JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor WHERE hh.inv_sts_pro=0 AND hh.inv_nomor_so = h.so_nomor), 0) < 
                IFNULL((SELECT SUM(dd.sod_jumlah) FROM tso_dtl dd WHERE dd.sod_so_nomor = h.so_nomor), 0)
    ) x
    `;
  const [totalRows] = await pool.query(countQuery, [
    user.cabang,
    searchTerm,
    searchTerm,
  ]);
  const total = totalRows[0].total;

  const dataQuery = `
    SELECT x.Nomor, x.Tanggal, x.KdCus, x.Customer, x.Alamat, x.Kota
    FROM (
        SELECT 
            h.so_nomor AS Nomor, h.so_tanggal AS Tanggal, h.so_cus_kode AS KdCus,
            c.cus_nama AS Customer, c.cus_alamat AS Alamat, c.cus_kota AS Kota,
            IFNULL((SELECT SUM(dd.sod_jumlah) FROM tso_dtl dd WHERE dd.sod_so_nomor = h.so_nomor), 0) AS qtyso,
            IFNULL((SELECT SUM(dd.invd_jumlah) FROM tinv_dtl dd JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor WHERE hh.inv_sts_pro=0 AND hh.inv_nomor_so = h.so_nomor), 0) AS qtyinv
        FROM tso_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
        WHERE h.so_aktif = "Y" AND h.so_close = 0 AND so_cab = ?
            AND (h.so_nomor LIKE ? OR c.cus_nama LIKE ?)
    ) x 
    WHERE x.qtyinv < x.qtyso
    ORDER BY x.Nomor DESC
    LIMIT ? OFFSET ?
    `;
  const [items] = await pool.query(dataQuery, [
    user.cabang,
    searchTerm,
    searchTerm,
    parseInt(itemsPerPage, 10),
    offset,
  ]);

  return { items, total };
};

/**
 * @description Mengambil detail SO untuk mengisi grid (logika edtsoExit).
 */
const getSoDetailsForGrid = async (soNomor, user) => {
  const connection = await pool.getConnection();
  try {
    const query = `
        SELECT 
            d.sod_kode AS kode, 
            IFNULL(b.brgd_barcode, '') AS barcode,
            -- Gunakan nama dari master jika ada, jika tidak gunakan kode barang sebagai fallback
            IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), d.sod_kode) AS nama,
            d.sod_ukuran AS ukuran,
            IFNULL((
                SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
                FROM tmasterstok m 
                WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=d.sod_kode AND m.mst_ukuran=d.sod_ukuran
            ), 0) AS stok,
            d.sod_jumlah AS qtyso
        FROM tso_dtl d
        JOIN tso_hdr h ON d.sod_so_nomor = h.so_nomor
        -- UBAH INNER JOIN MENJADI LEFT JOIN DI SINI
        LEFT JOIN tbarangdc a ON a.brg_kode = d.sod_kode AND a.brg_logstok="Y"
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sod_kode AND b.brgd_ukuran = d.sod_ukuran
        WHERE h.so_aktif = "Y" AND h.so_nomor = ?
        AND d.sod_sd_nomor = ''
        ORDER BY d.sod_nourut
    `;
    const [rows] = await connection.query(query, [user.cabang, soNomor]);

    const items = [];
    for (const row of rows) {
      const sudah = await getSudah(
        connection,
        soNomor,
        row.kode,
        row.ukuran,
        "",
      );
      items.push({
        ...row,
        sudah: sudah,
        belum: row.qtyso - sudah,
        jumlah: 0, // Default Qty Out
      });
    }
    return items;
  } finally {
    connection.release();
  }
};

/**
 * @description Menyimpan data Mutasi Out (logika simpandata).
 */
const save = async (data, user) => {
  const { header, items, isNew } = data;
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    let moNomor = header.nomor;
    let mo_idrec;
    if (isNew) {
      const now = new Date();
      mo_idrec = `${user.cabang}MO${format(now, "yyyyMMddHHmmss.SSS")}`;
    }

    if (isNew) {
      const prefix = `${user.cabang}MO${format(new Date(header.tanggal), "yyMM")}`;
      const [maxRows] = await connection.query(
        `SELECT IFNULL(MAX(RIGHT(mo_nomor, 5)), 0) as maxNum 
         FROM tmutasiout_hdr 
         WHERE LEFT(mo_nomor, 9) = ? FOR UPDATE`,
        [prefix],
      );
      const nextNum = parseInt(maxRows[0].maxNum, 10) + 1;
      moNomor = `${prefix}${String(100000 + nextNum).slice(1)}`;

      await connection.query(
        `INSERT INTO tmutasiout_hdr 
         (mo_idrec, mo_nomor, mo_tanggal, mo_so_nomor, mo_cab, mo_kecab, mo_ket, user_create, date_create) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          mo_idrec,
          moNomor,
          header.tanggal,
          header.soNomor,
          user.cabang,
          header.keCabang,
          header.keterangan,
          user.kode,
        ],
      );
    } else {
      await connection.query(
        `UPDATE tmutasiout_hdr 
         SET mo_tanggal = ?, mo_kecab = ?, mo_ket = ?, user_modified = ?, date_modified = NOW() 
         WHERE mo_nomor = ?`,
        [
          header.tanggal,
          header.keCabang,
          header.keterangan,
          user.kode,
          moNomor,
        ],
      );

      // BARU: revert status unit lama sebelum detail diganti
      const [oldSerials] = await connection.query(
        `SELECT mod_unit_serial FROM tmutasiout_dtl WHERE mod_nomor = ? AND mod_unit_serial IS NOT NULL`,
        [moNomor],
      );
      if (oldSerials.length > 0) {
        await connection.query(
          `UPDATE tbarangdc_unit SET unit_status = 'DI_TOKO', unit_lokasi_saat_ini = ? WHERE unit_serial IN (?)`,
          [user.cabang, oldSerials.map((r) => r.mod_unit_serial)],
        );
      }
    }

    await connection.query("DELETE FROM tmutasiout_dtl WHERE mod_nomor = ?", [
      moNomor,
    ]);

    const validItems = items.filter((item) => (item.jumlah || 0) > 0);
    const itemValues = [];
    const movedSerials = [];
    let rowCounter = 0;

    for (const item of validItems) {
      const qty = Number(item.jumlah) || 0;

      // BARU: FIFO-pick unit DI_TOKO — WAJIB filter lokasi = cabang
      // sendiri, supaya tidak comot unit yang fisiknya ada di toko lain
      const [rows] = await connection.query(
        `SELECT unit_serial FROM tbarangdc_unit
         WHERE unit_kode = ? AND unit_ukuran = ? AND unit_status = 'DI_TOKO' AND unit_lokasi_saat_ini = ?
         ORDER BY date_create ASC, unit_serial ASC
         LIMIT ? FOR UPDATE`,
        [item.kode, item.ukuran, user.cabang, qty],
      );
      const pickedSerials = rows.map((r) => r.unit_serial);

      for (const serial of pickedSerials) {
        rowCounter++;
        const mod_iddrec = `${moNomor}${String(rowCounter).padStart(3, "0")}`;
        itemValues.push([
          moNomor,
          mod_iddrec,
          moNomor,
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
        const mod_iddrec = `${moNomor}${String(rowCounter).padStart(3, "0")}`;
        itemValues.push([
          moNomor,
          mod_iddrec,
          moNomor,
          item.kode,
          item.ukuran,
          sisaQty,
          null,
        ]);
      }
    }

    if (itemValues.length > 0) {
      await connection.query(
        `INSERT INTO tmutasiout_dtl 
             (mod_idrec, mod_iddrec, mod_nomor, mod_kode, mod_ukuran, mod_jumlah, mod_unit_serial) 
             VALUES ?`,
        [itemValues],
      );
    }

    if (movedSerials.length > 0) {
      await connection.query(
        `UPDATE tbarangdc_unit SET unit_status = 'TRANSIT_PRODUKSI', unit_lokasi_saat_ini = ?,
           date_modified = NOW(), user_modified = ?
         WHERE unit_serial IN (?)`,
        [header.keCabang, user.kode, movedSerials],
      );
    }

    await connection.commit();
    return {
      message: `Data Mutasi Out ${moNomor} berhasil disimpan.`,
      nomor: moNomor,
    };
  } catch (error) {
    await connection.rollback();
    console.error("Save Mutasi Out Error:", error);
    throw new Error("Gagal menyimpan data Mutasi Out.");
  } finally {
    connection.release();
  }
};

/**
 * @description Memuat data saat mode Ubah (logika loaddataall).
 */
const loadForEdit = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    const [headerRows] = await connection.query(
      "SELECT * FROM tmutasiout_hdr WHERE mo_nomor = ?",
      [nomor],
    );
    if (headerRows.length === 0)
      throw new Error("Data Mutasi Out tidak ditemukan.");
    const header = headerRows[0];

    const [savedDetails] = await connection.query(
      "SELECT * FROM tmutasiout_dtl WHERE mod_nomor = ?",
      [nomor],
    );

    // BARU: agregasi savedDetails per kode+ukuran
    const savedMap = new Map();
    for (const d of savedDetails) {
      const key = `${d.mod_kode}|${d.mod_ukuran}`;
      savedMap.set(key, (savedMap.get(key) || 0) + Number(d.mod_jumlah));
    }

    const templateItems = await getSoDetailsForGrid(header.mo_so_nomor, user);

    const items = templateItems.map((item) => {
      const key = `${item.kode}|${item.ukuran}`;
      return {
        ...item,
        jumlah: savedMap.get(key) || 0,
      };
    });

    return { header, items };
  } finally {
    connection.release();
  }
};

const getPrintData = async (nomor, user) => {
  const query = `
    SELECT 
        MAX(h.mo_nomor) AS mo_nomor, MAX(h.mo_tanggal) AS mo_tanggal, MAX(h.mo_so_nomor) AS mo_so_nomor,
        MAX(h.mo_kecab) AS mo_kecab, MAX(h.mo_ket) AS mo_ket,
        MAX(g.pab_nama) AS pab_nama,
        d.mod_kode, d.mod_ukuran, SUM(d.mod_jumlah) AS mod_jumlah,
        MAX(b.brgd_barcode) AS brgd_barcode,
        MAX(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna))) AS nama,
        MAX(DATE_FORMAT(h.date_create, "%d-%m-%Y %T")) AS created,
        MAX(h.user_create) AS user_create,
        MAX(src.gdg_inv_nama) AS perush_nama,
        MAX(src.gdg_inv_alamat) AS perush_alamat,
        MAX(src.gdg_inv_telp) AS perush_telp
    FROM tmutasiout_hdr h
    LEFT JOIN tmutasiout_dtl d ON d.mod_nomor = h.mo_nomor
    LEFT JOIN tbarangdc a ON a.brg_kode = d.mod_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.mod_kode AND b.brgd_ukuran = d.mod_ukuran
    LEFT JOIN kencanaprint.tpabrik g ON g.pab_kode = h.mo_kecab
    LEFT JOIN tgudang src ON src.gdg_kode = h.mo_cab
    WHERE h.mo_nomor = ?
    GROUP BY d.mod_kode, d.mod_ukuran
    ORDER BY d.mod_kode;
    `;

  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) {
    throw new Error("Data Mutasi Out tidak ditemukan.");
  }

  const header = { ...rows[0] };
  const details = rows.map((row) => ({
    mod_kode: row.mod_kode,
    nama: row.nama,
    mod_ukuran: row.mod_ukuran,
    mod_jumlah: row.mod_jumlah,
  }));

  return { header, details };
};

const getExportDetails = async (filters) => {
  const { startDate, endDate } = filters;

  const query = `
    SELECT 
        MAX(h.mo_nomor) AS 'Nomor Mutasi',
        MAX(h.mo_tanggal) AS 'Tanggal',
        MAX(h.mo_so_nomor) AS 'No SO',
        MAX(h.mo_kecab) AS 'Ke Cabang',
        MAX(p.pab_nama) AS 'Nama Cabang',
        MAX(h.mo_ket) AS 'Keterangan',
        d.mod_kode AS 'Kode Barang',
        MAX(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna))) AS 'Nama Barang',
        d.mod_ukuran AS 'Ukuran',
        SUM(d.mod_jumlah) AS 'Qty Out'
    FROM tmutasiout_hdr h
    JOIN tmutasiout_dtl d ON h.mo_nomor = d.mod_nomor
    LEFT JOIN tbarangdc a ON a.brg_kode = d.mod_kode
    LEFT JOIN kencanaprint.tpabrik p ON p.pab_kode = h.mo_kecab
    WHERE DATE(h.mo_tanggal) BETWEEN ? AND ?
    GROUP BY h.mo_nomor, d.mod_kode, d.mod_ukuran
    ORDER BY h.mo_nomor;
    `;

  const [rows] = await pool.query(query, [startDate, endDate]);
  return rows;
};

module.exports = {
  searchSo,
  getSoDetailsForGrid,
  save,
  loadForEdit,
  getPrintData,
  getExportDetails,
};
