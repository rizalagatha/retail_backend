const pool = require("../config/database");
const { format } = require("date-fns");

/**
 * Menghasilkan nomor Surat Jalan Workshop (SJW) baru.
 * Format: W01.SJW.YYMM.NNNN
 */
const generateNewSjNumber = async (cabang, tanggal) => {
  const [year, month] = tanggal.split("-");
  const prefix = `${cabang}.SJW.${year.substring(2)}${month}.`;

  const query = `
        SELECT IFNULL(MAX(RIGHT(sjw_nomor, 4)), 0) + 1 AS next_num
        FROM tsj_workshop_hdr 
        WHERE sjw_nomor LIKE ?;
    `;
  const [rows] = await pool.query(query, [`${prefix}%`]);
  const nextNumber = rows[0].next_num.toString().padStart(4, "0");

  return `${prefix}${nextNumber}`;
};

/**
 * Menyimpan data Surat Jalan Workshop (Baru atau Ubah).
 */
const saveData = async (payload, user) => {
  const { header, items, isNew } = payload;

  // Validasi Tanggal Server (Hanya untuk insert baru)
  if (isNew) {
    const serverDate = format(new Date(), "yyyy-MM-dd");
    const inputDate = format(new Date(header.tanggal), "yyyy-MM-dd");

    if (inputDate !== serverDate) {
      throw new Error(
        `Gagal Simpan: Tanggal SJ (${inputDate}) harus hari ini (${serverDate}).`,
      );
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (!header.store?.kode) throw new Error("Store tujuan harus diisi.");
    if (items.length === 0) throw new Error("Detail barang harus diisi.");

    let totalQty = 0;
    for (const item of items) {
      totalQty += Number(item.jumlah || 0);
    }
    if (totalQty <= 0) throw new Error("Total jumlah barang tidak boleh nol.");

    let sjNomor = header.nomor;

    // 1. INSERT / UPDATE HEADER
    if (isNew) {
      sjNomor = await generateNewSjNumber(user.cabang, header.tanggal);
      const headerSql = `
        INSERT INTO tsj_workshop_hdr (
        sjw_nomor, sjw_tanggal, sjw_tujuan_cab, sjw_ket, sjw_so_nomor, user_create, date_create
        ) VALUES (?, ?, ?, ?, ?, ?, NOW());
    `;
      await connection.query(headerSql, [
        sjNomor,
        header.tanggal,
        header.store.kode,
        header.keterangan,
        header.soNomor || "",
        user.kode,
      ]);
    } else {
      const headerSql = `
        UPDATE tsj_workshop_hdr 
        SET sjw_tanggal = ?, sjw_tujuan_cab = ?, sjw_ket = ?, sjw_so_nomor = ?, 
            user_modified = ?, date_modified = NOW()
        WHERE sjw_nomor = ?;
    `;
      await connection.query(headerSql, [
        header.tanggal,
        header.store.kode,
        header.keterangan,
        header.soNomor || "",
        user.kode,
        sjNomor,
      ]);
    }

    // 2. HAPUS DETAIL LAMA
    await connection.query(
      "DELETE FROM tsj_workshop_dtl WHERE sjwd_nomor = ?",
      [sjNomor],
    );

    // 3. INSERT DETAIL BARU
    const detailSql = `
      INSERT INTO tsj_workshop_dtl (sjwd_iddrec, sjwd_nomor, sjwd_kode, sjwd_ukuran, sjwd_jumlah)
      VALUES ?;
    `;

    const detailValues = items
      .filter((item) => item.kode && item.jumlah > 0)
      .map((item, index) => {
        const nourut = index + 1;
        const iddrec = `${sjNomor}${nourut}`; // ID Unik untuk trigger pemotong stok
        return [iddrec, sjNomor, item.kode, item.ukuran, item.jumlah];
      });

    if (detailValues.length > 0) {
      await connection.query(detailSql, [detailValues]);
    }

    await connection.commit();
    return {
      message: `Surat Jalan Workshop ${sjNomor} berhasil disimpan.`,
      nomor: sjNomor,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Memuat data untuk mode Ubah (Edit).
 */
const loadForEdit = async (nomor, user) => {
  const headerQuery = `
    SELECT 
        h.sjw_nomor AS nomor,
        h.sjw_tanggal AS tanggal,
        h.sjw_ket AS keterangan,
        h.sjw_tujuan_cab AS store_kode,
        h.sjw_so_nomor AS soNomor,
        s.gdg_nama AS store_nama
    FROM tsj_workshop_hdr h                  
    LEFT JOIN tgudang s ON s.gdg_kode = h.sjw_tujuan_cab
    WHERE h.sjw_nomor = ?;
  `;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0)
    throw new Error("Data Surat Jalan tidak ditemukan");

  const itemsQuery = `
    SELECT
        d.sjwd_kode AS kode,
        b.brgd_barcode AS barcode,
        TRIM(CONCAT(IFNULL(a.brg_jeniskaos,''), " ", IFNULL(a.brg_tipe,''), " ", IFNULL(a.brg_lengan,''), " ", IFNULL(a.brg_jeniskain,''), " ", IFNULL(a.brg_warna,''))) AS nama,
        d.sjwd_ukuran AS ukuran,
        d.sjwd_jumlah AS jumlah,
        IFNULL((
            SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
            FROM tmasterstok m 
            WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_brg_kode=d.sjwd_kode AND m.mst_ukuran=d.sjwd_ukuran
        ), 0) AS stok
    FROM tsj_workshop_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.sjwd_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sjwd_kode AND b.brgd_ukuran = d.sjwd_ukuran
    WHERE d.sjwd_nomor = ?;
  `;
  const [items] = await pool.query(itemsQuery, [user.cabang, nomor]);

  return { header: headerRows[0], items };
};

/**
 * Mencari barang berdasarkan Barcode (termasuk cek stok real-time).
 */
const findByBarcode = async (barcode, gudang) => {
  const query = `
    SELECT
        d.brgd_barcode AS barcode,
        d.brgd_kode AS kode,
        TRIM(CONCAT(IFNULL(h.brg_jeniskaos,''), " ", IFNULL(h.brg_tipe,''), " ", IFNULL(h.brg_lengan,''), " ", IFNULL(h.brg_jeniskain,''), " ", IFNULL(h.brg_warna,''))) AS nama,
        d.brgd_ukuran AS ukuran,
        IFNULL((
            SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
            FROM tmasterstok m 
            WHERE m.mst_aktif = 'Y' AND m.mst_cab = ? AND m.mst_brg_kode = d.brgd_kode AND m.mst_ukuran = d.brgd_ukuran
        ), 0) AS stok
    FROM tbarangdc_dtl d
    LEFT JOIN tbarangdc h ON h.brg_kode = d.brgd_kode
    WHERE h.brg_aktif = 0 AND d.brgd_barcode = ?;
  `;

  const [rows] = await pool.query(query, [gudang, barcode]);
  if (rows.length === 0) {
    throw new Error("Barcode tidak ditemukan atau barang tidak aktif.");
  }
  return rows[0];
};

const searchSoBordirSelesai = async (term, page, itemsPerPage) => {
  const limit = parseInt(itemsPerPage) || 10;
  const offset = (parseInt(page) - 1) * limit;
  const searchTerm = `%${term || ""}%`;

  const subQuery = `
    SELECT 
      h.so_nomor AS Nomor, 
      h.so_tanggal AS Tanggal,
      c.cus_nama AS Customer, 
      (SELECT d.sod_sd_nomor FROM tso_dtl d WHERE d.sod_so_nomor = h.so_nomor AND d.sod_sd_nomor LIKE '%.BR.%' LIMIT 1) AS Keterangan,
      
      -- 1. Cek Total SO DTF (Bordir) di dalam SO
      IFNULL((SELECT COUNT(DISTINCT dd.sod_sd_nomor) 
              FROM tso_dtl dd 
              WHERE dd.sod_so_nomor = h.so_nomor 
                AND dd.sod_sd_nomor LIKE '%.BR.%'), 0) AS total_so_dtf,
                
      -- 2. Cek LHK (tdtf) yang sudah dibuat untuk SO tersebut
      IFNULL((SELECT COUNT(DISTINCT lhk.sodtf) 
              FROM tdtf lhk 
              JOIN tso_dtl dd ON lhk.sodtf = dd.sod_sd_nomor
              WHERE dd.sod_so_nomor = h.so_nomor), 0) AS lhk_created
    FROM tso_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
    WHERE h.so_aktif = 'Y' AND h.so_close = 0 
  `;

  // FILTER UTAMA: Hanya SO yang punya Bordir dan LHK-nya sudah lengkap
  const baseQuery = `
    FROM (${subQuery}) AS x 
    WHERE x.total_so_dtf > 0 
      AND x.lhk_created >= x.total_so_dtf
  `;

  const searchWhere = term ? `AND (x.Nomor LIKE ? OR x.Customer LIKE ?)` : ``;
  const params = term ? [searchTerm, searchTerm] : [];

  const countQuery = `SELECT COUNT(*) AS total ${baseQuery} ${searchWhere}`;
  const [countRows] = await pool.query(countQuery, params);

  const dataQuery = `
    SELECT x.Nomor, x.Tanggal, x.Customer, x.Keterangan
    ${baseQuery}
    ${searchWhere}
    ORDER BY x.Tanggal DESC, x.Nomor DESC
    LIMIT ? OFFSET ?
  `;

  const [items] = await pool.query(dataQuery, [...params, limit, offset]);
  return { items, total: countRows[0].total };
};

const getItemsFromSo = async (soNomor, gudang) => {
  const query = `
    SELECT 
      d.sod_kode         AS kode,
      b.brgd_barcode     AS barcode,
      TRIM(CONCAT(
        IFNULL(a.brg_jeniskaos,''), ' ',
        IFNULL(a.brg_tipe,''), ' ',
        IFNULL(a.brg_lengan,''), ' ',
        IFNULL(a.brg_jeniskain,''), ' ',
        IFNULL(a.brg_warna,'')
      ))                 AS nama,
      d.sod_ukuran       AS ukuran,
      SUM(d.sod_jumlah)  AS jumlahSo,
      0                  AS jumlah,
      IFNULL((
        SELECT SUM(m.mst_stok_in - m.mst_stok_out)
        FROM tmasterstok m
        WHERE m.mst_aktif = 'Y'
          AND m.mst_cab = ?
          AND m.mst_brg_kode = d.sod_kode
          AND m.mst_ukuran = d.sod_ukuran
      ), 0)              AS stok
    FROM tso_dtl d
    INNER JOIN tbarangdc a ON a.brg_kode = d.sod_kode
    LEFT JOIN tbarangdc_dtl b 
      ON b.brgd_kode = d.sod_kode 
      AND b.brgd_ukuran = d.sod_ukuran
    WHERE d.sod_so_nomor = ?
      AND d.sod_kode NOT LIKE 'JASA%'
      AND d.sod_kode != 'CUSTOM'
      AND d.sod_custom = 'N'
      AND a.brg_logstok = 'Y'
    GROUP BY d.sod_kode, d.sod_ukuran
    ORDER BY a.brg_jeniskaos, a.brg_tipe, d.sod_ukuran
  `;
  const [rows] = await pool.query(query, [gudang, soNomor]);
  return rows;
};

const getPrintData = async (nomor) => {
  const headerQuery = `
    SELECT 
      h.sjw_nomor,
      h.sjw_tanggal,
      h.sjw_so_nomor,
      h.sjw_ket,
      h.user_create,
      h.date_create,
      CONCAT(h.sjw_tujuan_cab, ' - ', g.gdg_nama) AS store,
      src.gdg_inv_nama    AS perush_nama,
      src.gdg_inv_alamat  AS perush_alamat,
      src.gdg_inv_telp    AS perush_telp
    FROM tsj_workshop_hdr h
    LEFT JOIN tgudang g   ON g.gdg_kode   = h.sjw_tujuan_cab
    LEFT JOIN tgudang src ON src.gdg_kode = LEFT(h.sjw_nomor, 3)
    WHERE h.sjw_nomor = ?
  `;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0)
    throw new Error("Data SJ Workshop tidak ditemukan.");

  const detailQuery = `
    SELECT 
      d.sjwd_kode AS sjd_kode,
      COALESCE(
        NULLIF(TRIM(CONCAT(
          IFNULL(a.brg_jeniskaos,''), ' ',
          IFNULL(a.brg_tipe,''), ' ',
          IFNULL(a.brg_lengan,''), ' ',
          IFNULL(a.brg_jeniskain,''), ' ',
          IFNULL(a.brg_warna,'')
        )), ''),
        b.brg_nama
      ) AS nama_barang,
      d.sjwd_ukuran AS sjd_ukuran,
      d.sjwd_jumlah AS sjd_jumlah
    FROM tsj_workshop_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.sjwd_kode
    LEFT JOIN kencanaprint.tgarmen_brg b ON b.brg_kode = d.sjwd_kode
    WHERE d.sjwd_nomor = ?
    ORDER BY d.sjwd_kode, d.sjwd_ukuran
  `;
  const [detailRows] = await pool.query(detailQuery, [nomor]);

  return { header: headerRows[0], details: detailRows };
};

module.exports = {
  saveData,
  loadForEdit,
  findByBarcode,
  searchSoBordirSelesai,
  getItemsFromSo,
  getPrintData,
};
