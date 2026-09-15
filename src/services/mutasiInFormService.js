const pool = require("../config/database");
const { format } = require("date-fns");

/**
 * Menghasilkan nomor Mutasi In (MI) baru.
 * Format: K01MI250900001
 */
const generateNewMiNumber = async (cabang, tanggal) => {
  const date = new Date(tanggal);
  const prefix = `${cabang}MI${format(date, "yyMM")}`;

  const query = `
    SELECT IFNULL(MAX(RIGHT(mi_nomor, 5)), 0) + 1 AS next_num
    FROM tmutasiin_hdr 
    WHERE mi_nomor LIKE ?;
  `;
  const [rows] = await pool.query(query, [`${prefix}%`]);
  const nextNumber = rows[0].next_num.toString().padStart(5, "0");

  return `${prefix}${nextNumber}`;
};

/**
 * Mengambil detail dari Mutasi Out yang dipilih untuk mengisi grid.
 * Termasuk kalkulasi 'sudah' dan 'belum'.
 */
const loadFromMo = async (nomorMo, user) => {
  const headerQuery = `
    SELECT 
      h.mo_nomor AS nomor,
      h.mo_so_nomor AS nomorSo,
      h.mo_kecab AS dariCabangKode,
      p.pab_nama AS dariCabangNama
    FROM tmutasiout_hdr h
    LEFT JOIN kencanaprint.tpabrik p ON p.pab_kode = h.mo_kecab
    WHERE h.mo_nomor = ?;
  `;
  const [headerRows] = await pool.query(headerQuery, [nomorMo]);
  if (headerRows.length === 0)
    throw new Error("Data Mutasi Out tidak ditemukan.");

  const itemsQuery = `
    SELECT
      d.mod_kode AS kode,
      MAX(b.brgd_barcode) AS barcode,
      MAX(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna))) AS nama,
      d.mod_ukuran AS ukuran,
      SUM(d.mod_jumlah) AS qtyMo,
      IFNULL((
        SELECT SUM(dd.mid_jumlah) FROM tmutasiin_dtl dd 
        JOIN tmutasiin_hdr hh ON hh.mi_nomor = dd.mid_nomor 
        WHERE hh.mi_mo_nomor = ? AND dd.mid_kode = d.mod_kode AND dd.mid_ukuran = d.mod_ukuran
      ), 0) AS sudah,
      (SUM(d.mod_jumlah) - IFNULL((
      SELECT SUM(dd.mid_jumlah)
      FROM tmutasiin_dtl dd
      JOIN tmutasiin_hdr hh ON hh.mi_nomor = dd.mid_nomor
      WHERE hh.mi_mo_nomor = ? 
        AND dd.mid_kode = d.mod_kode 
        AND dd.mid_ukuran = d.mod_ukuran
      ), 0)) AS belum
    FROM tmutasiout_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.mod_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.mod_kode AND b.brgd_ukuran = d.mod_ukuran
    WHERE d.mod_nomor = ?
    GROUP BY d.mod_kode, d.mod_ukuran;
  `;
  const [items] = await pool.query(itemsQuery, [nomorMo, nomorMo, nomorMo]);
  return { header: headerRows[0], items };
};

/**
 * Menyimpan data Mutasi In (baru atau ubah).
 */
const saveData = async (payload, user) => {
  const { header, items, isNew } = payload;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (!header.nomorMutasiOut)
      throw new Error("Nomor Mutasi Out harus diisi.");
    if (items.length === 0) throw new Error("Detail barang harus diisi.");

    let miNomor = header.nomor;
    const timestamp = format(new Date(), "yyyyMMddHHmmssSSS");
    const idrec = `${user.cabang}MI${timestamp}`;

    if (isNew) {
      miNomor = await generateNewMiNumber(user.cabang, header.tanggal);
      const headerSql = `
        INSERT INTO tmutasiin_hdr 
        (mi_idrec, mi_nomor, mi_tanggal, mi_mo_nomor, mi_so_nomor, mi_cab, mi_ket, user_create, date_create)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW());
      `;
      await connection.query(headerSql, [
        idrec,
        miNomor,
        header.tanggal,
        header.nomorMutasiOut,
        header.nomorSo,
        user.cabang,
        header.keterangan,
        user.kode,
      ]);
    } else {
      const headerSql = `
        UPDATE tmutasiin_hdr SET mi_tanggal = ?, mi_ket = ?, user_modified = ?, date_modified = NOW()
        WHERE mi_nomor = ?;
      `;
      await connection.query(headerSql, [
        header.tanggal,
        header.keterangan,
        user.kode,
        miNomor,
      ]);

      // BARU: revert status unit lama sebelum detail diganti
      const [oldSerials] = await connection.query(
        `SELECT mid_unit_serial FROM tmutasiin_dtl WHERE mid_nomor = ? AND mid_unit_serial IS NOT NULL`,
        [miNomor],
      );
      if (oldSerials.length > 0) {
        await connection.query(
          `UPDATE tbarangdc_unit SET unit_status = 'TRANSIT_PRODUKSI' WHERE unit_serial IN (?)`,
          [oldSerials.map((r) => r.mid_unit_serial)],
        );
      }
    }

    await connection.query("DELETE FROM tmutasiin_dtl WHERE mid_nomor = ?", [
      miNomor,
    ]);

    const returnedSerials = [];
    let rowCounter = 0;

    for (const item of items) {
      const qty = Number(item.qtyIn) || 0;
      if (qty <= 0) continue;

      // BARU: cari unit_serial spesifik yang keluar lewat Mutasi Out
      // ini, dikurangi yang sudah pernah masuk lewat Mutasi In lain
      // untuk mo_nomor yang sama
      const [candidateRows] = await connection.query(
        `SELECT mod_unit_serial FROM tmutasiout_dtl
         WHERE mod_nomor = ? AND mod_kode = ? AND mod_ukuran = ?
           AND mod_unit_serial IS NOT NULL
           AND mod_unit_serial NOT IN (
             SELECT dd.mid_unit_serial FROM tmutasiin_dtl dd
             INNER JOIN tmutasiin_hdr hh ON hh.mi_nomor = dd.mid_nomor
             WHERE hh.mi_mo_nomor = ? AND dd.mid_unit_serial IS NOT NULL
           )
         ORDER BY mod_unit_serial ASC
         LIMIT ? FOR UPDATE`,
        [
          header.nomorMutasiOut,
          item.kode,
          item.ukuran,
          header.nomorMutasiOut,
          qty,
        ],
      );
      const pickedSerials = candidateRows.map((r) => r.mod_unit_serial);

      for (const serial of pickedSerials) {
        rowCounter++;
        const iddrec = `${idrec}${rowCounter}`;
        await connection.query(
          `INSERT INTO tmutasiin_dtl (mid_idrec, mid_iddrec, mid_nomor, mid_kode, mid_ukuran, mid_jumlah, mid_unit_serial) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [idrec, iddrec, miNomor, item.kode, item.ukuran, 1, serial],
        );
        returnedSerials.push(serial);
      }

      const sisaQty = qty - pickedSerials.length;
      if (sisaQty > 0) {
        rowCounter++;
        const iddrec = `${idrec}${rowCounter}`;
        await connection.query(
          `INSERT INTO tmutasiin_dtl (mid_idrec, mid_iddrec, mid_nomor, mid_kode, mid_ukuran, mid_jumlah, mid_unit_serial) 
           VALUES (?, ?, ?, ?, ?, ?, NULL)`,
          [idrec, iddrec, miNomor, item.kode, item.ukuran, sisaQty],
        );
      }
    }

    if (returnedSerials.length > 0) {
      await connection.query(
        `UPDATE tbarangdc_unit SET unit_status = 'DI_TOKO', unit_lokasi_saat_ini = ?,
           date_modified = NOW(), user_modified = ?
         WHERE unit_serial IN (?)`,
        [user.cabang, user.kode, returnedSerials],
      );
    }

    await connection.commit();
    return {
      message: `Mutasi In ${miNomor} berhasil disimpan.`,
      nomor: miNomor,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Memuat data Mutasi In untuk mode Ubah.
 */
const loadForEdit = async (nomorMi, user) => {
  const connection = await pool.getConnection();
  try {
    const [headerRows] = await connection.query(
      `SELECT 
         h.mi_nomor AS nomor, h.mi_tanggal AS tanggal, h.mi_mo_nomor AS nomorMutasiOut,
         h.mi_so_nomor AS nomorSo, h.mi_ket AS keterangan,
         o.mo_kecab AS dariCabangKode, p.pab_nama AS dariCabangNama
       FROM tmutasiin_hdr h
       LEFT JOIN tmutasiout_hdr o ON o.mo_nomor = h.mi_mo_nomor
       LEFT JOIN kencanaprint.tpabrik p ON p.pab_kode = o.mo_kecab
       WHERE h.mi_nomor = ?`,
      [nomorMi],
    );
    if (headerRows.length === 0)
      throw new Error("Data Mutasi In tidak ditemukan.");
    const header = headerRows[0];
    const nomorMo = header.nomorMutasiOut;

    const moItemsQuery = `
      SELECT
        d.mod_kode AS kode,
        MAX(b.brgd_barcode) AS barcode,
        MAX(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna))) AS nama,
        d.mod_ukuran AS ukuran,
        SUM(d.mod_jumlah) AS qtyMo,
        IFNULL((
            SELECT SUM(dd.mid_jumlah) FROM tmutasiin_dtl dd 
            JOIN tmutasiin_hdr hh ON hh.mi_nomor = dd.mid_nomor 
            WHERE hh.mi_mo_nomor = ? 
              AND dd.mid_kode = d.mod_kode 
              AND dd.mid_ukuran = d.mod_ukuran
              AND hh.mi_nomor <> ?
        ), 0) AS sudah
      FROM tmutasiout_dtl d
      LEFT JOIN tbarangdc a ON a.brg_kode = d.mod_kode
      LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.mod_kode AND b.brgd_ukuran = d.mod_ukuran
      WHERE d.mod_nomor = ?
      GROUP BY d.mod_kode, d.mod_ukuran;
    `;
    const [moItems] = await connection.query(moItemsQuery, [
      nomorMo,
      nomorMi,
      nomorMo,
    ]);

    const [miItemsRaw] = await connection.query(
      "SELECT mid_kode, mid_ukuran, mid_jumlah FROM tmutasiin_dtl WHERE mid_nomor = ?",
      [nomorMi],
    );

    // BARU: agregasi miItemsRaw per kode+ukuran
    const miMap = new Map();
    for (const d of miItemsRaw) {
      const key = `${d.mid_kode}|${d.mid_ukuran}`;
      miMap.set(key, (miMap.get(key) || 0) + Number(d.mid_jumlah));
    }

    const items = moItems.map((item) => {
      const key = `${item.kode}|${item.ukuran}`;
      return {
        ...item,
        qtyIn: miMap.get(key) || 0,
      };
    });

    return { header, items };
  } finally {
    connection.release();
  }
};

const getPrintData = async (nomor) => {
  const query = `
    SELECT 
      MAX(h.mi_nomor) AS mi_nomor, MAX(h.mi_tanggal) AS mi_tanggal, MAX(h.mi_so_nomor) AS mi_so_nomor, MAX(h.mi_ket) AS mi_ket,
      MAX(i.mo_kecab) AS dari_cabang_kode,
      MAX(p.pab_nama) AS dari_cabang_nama,
      MAX(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna))) AS nama,
      d.mid_kode, d.mid_ukuran, SUM(d.mid_jumlah) AS mid_jumlah,
      MAX(DATE_FORMAT(h.date_create, "%d-%m-%Y %T")) AS created,
      MAX(h.user_create) AS user_create,
      MAX(src.gdg_inv_nama) AS perush_nama,
      MAX(src.gdg_inv_alamat) AS perush_alamat,
      MAX(src.gdg_inv_telp) AS perush_telp
    FROM tmutasiin_hdr h
    LEFT JOIN tmutasiin_dtl d ON d.mid_nomor = h.mi_nomor
    LEFT JOIN tmutasiout_hdr i ON i.mo_nomor = h.mi_mo_nomor
    LEFT JOIN kencanaprint.tpabrik p ON p.pab_kode = i.mo_kecab
    LEFT JOIN tbarangdc a ON a.brg_kode = d.mid_kode
    LEFT JOIN tgudang src ON src.gdg_kode = h.mi_cab
    WHERE h.mi_nomor = ?
    GROUP BY d.mid_kode, d.mid_ukuran
    ORDER BY d.mid_kode;
  `;

  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) {
    throw new Error("Data Mutasi In tidak ditemukan.");
  }

  const header = { ...rows[0] };
  const details = rows.map((row) => ({
    mid_kode: row.mid_kode,
    nama: row.nama,
    mid_ukuran: row.mid_ukuran,
    mid_jumlah: row.mid_jumlah,
  }));

  return { header, details };
};

/**
 * Mencari dokumen Mutasi Out yang valid (belum diterima penuh).
 * Diadaptasi dari query F1 di edtmo pada Delphi.
 */
const searchMutasiOut = async (term, page, itemsPerPage, user) => {
  const offset = (page - 1) * itemsPerPage;
  const searchTerm = `%${term || ""}%`;

  // Query inner/subquery yang menghitung qty_out dan qty_in
  const subQuery = `
    SELECT 
      h.mo_nomor AS Nomor,
      h.mo_tanggal AS Tanggal,
      p.pab_nama AS DariCabangNama,
      h.mo_so_nomor AS NoSO,
      c.cus_nama AS Customer,
      IFNULL((SELECT SUM(dd.mod_jumlah) FROM tmutasiout_dtl dd WHERE dd.mod_nomor = h.mo_nomor), 0) AS qty_out,
      IFNULL((SELECT SUM(dd.mid_jumlah) FROM tmutasiin_dtl dd JOIN tmutasiin_hdr hh ON hh.mi_nomor = dd.mid_nomor WHERE hh.mi_mo_nomor = h.mo_nomor), 0) AS qty_in
    FROM tmutasiout_hdr h
    LEFT JOIN tso_hdr o ON o.so_nomor = h.mo_so_nomor
    LEFT JOIN tcustomer c ON c.cus_kode = o.so_cus_kode
    LEFT JOIN kencanaprint.tpabrik p ON p.pab_kode = h.mo_kecab
    WHERE h.mo_cab = ?
    `;

  // Query dibungkus sebagai derived table 'x', persis seperti di Delphi
  const baseFrom = `FROM (${subQuery}) AS x`;

  const whereClause = `WHERE x.qty_in < x.qty_out`;
  const searchClause = `AND (x.Nomor LIKE ? OR x.NoSO LIKE ? OR x.Customer LIKE ?)`;

  const countParams = [user.cabang];
  const dataParams = [user.cabang];

  if (term) {
    countParams.push(searchTerm, searchTerm, searchTerm);
    dataParams.push(searchTerm, searchTerm, searchTerm);
  }

  const countQuery = `SELECT COUNT(*) AS total ${baseFrom} ${whereClause} ${
    term ? searchClause : ""
  }`;
  const [countRows] = await pool.query(countQuery, countParams);
  const total = countRows[0].total;

  const dataQuery = `
    SELECT x.Nomor, x.Tanggal, x.DariCabangNama, x.NoSO, x.Customer
    ${baseFrom} ${whereClause} ${term ? searchClause : ""}
    ORDER BY x.Tanggal DESC, x.Nomor DESC
    LIMIT ? OFFSET ?;
  `;
  dataParams.push(itemsPerPage, offset);
  const [items] = await pool.query(dataQuery, dataParams);

  return { items, total };
};

const getExportDetails = async (filters) => {
  const { startDate, endDate, cabang } = filters;
  const query = `
    SELECT 
      MAX(h.mi_nomor) AS 'Nomor Mutasi In',
      MAX(h.mi_tanggal) AS 'Tanggal',
      MAX(h.mi_mo_nomor) AS 'Nomor Mutasi Out',
      MAX(h.mi_so_nomor) AS 'Nomor SO',
      MAX(c.cus_nama) AS 'Customer',
      d.mid_kode AS 'Kode Barang',
      MAX(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna))) AS 'Nama Barang',
      d.mid_ukuran AS 'Ukuran',
      SUM(d.mid_jumlah) AS 'Qty'
    FROM tmutasiin_hdr h
    JOIN tmutasiin_dtl d ON h.mi_nomor = d.mid_nomor
    LEFT JOIN tso_hdr o ON o.so_nomor = h.mi_so_nomor
    LEFT JOIN tcustomer c ON c.cus_kode = o.so_cus_kode
    LEFT JOIN tbarangdc a ON a.brg_kode = d.mid_kode
    WHERE h.mi_cab = ? 
      AND h.mi_tanggal BETWEEN ? AND ?
    GROUP BY h.mi_nomor, d.mid_kode, d.mid_ukuran
    ORDER BY h.mi_nomor;
  `;
  const [rows] = await pool.query(query, [cabang, startDate, endDate]);
  return rows;
};

module.exports = {
  saveData,
  loadFromMo,
  loadForEdit,
  getPrintData,
  searchMutasiOut,
  getExportDetails,
};
