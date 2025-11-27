const pool = require("../config/database");
const { format } = require("date-fns");

// Fungsi untuk membuat nomor Proforma baru
const generateNewNumber = async (connection, branchCode, date) => {
  const prefix = `${branchCode}.INP.${format(new Date(date), "yyMM")}`;
  const query = `SELECT IFNULL(MAX(RIGHT(inv_nomor, 4)), 0) as max_nomor FROM tinv_hdr WHERE inv_cab = ? AND LEFT(inv_nomor, 12) = ?`;
  const [rows] = await connection.query(query, [branchCode, prefix]);
  const nextNumber = parseInt(rows[0].max_nomor, 10) + 1;
  return `${prefix}.${String(nextNumber).padStart(4, "0")}`;
};

// Fungsi untuk mengambil data SO untuk di-copy ke Proforma
const getDataFromSO = async (soNumber, branchCode) => {
  // Query ini adalah terjemahan dari edtSoExit di Delphi
  const headerQuery = `
        SELECT 
            h.so_cus_kode AS customerKode, c.cus_nama AS customerNama, c.cus_alamat AS alamat, c.cus_kota AS kota, c.cus_telp AS telp,
            h.so_cus_level AS levelKode, l.level_nama AS levelNama, h.so_tanggal AS tanggalSo,
            h.so_top AS top, h.so_ppn AS ppn, h.so_disc AS diskon, h.so_disc1 AS diskonPersen,
            h.so_bkrm AS biayaKirim, h.so_dp AS dp
        FROM tso_hdr h
        LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
        LEFT JOIN tcustomer_level l ON l.level_kode = h.so_cus_level
        WHERE h.so_nomor = ? AND h.inv_cab = ?;
    `;
  const [headerRows] = await pool.query(headerQuery, [soNumber, branchCode]);
  if (headerRows.length === 0) throw new Error("Nomor SO tidak ditemukan.");

  const itemsQuery = `
        SELECT 
            d.sod_kode AS kode, d.sod_ukuran AS ukuran, d.sod_jumlah AS jumlah, d.sod_harga AS harga,
            d.sod_disc AS diskonPersen, d.sod_diskon AS diskonRp,
            IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), f.sd_nama) AS nama,
            b.brgd_barcode as barcode
        FROM tso_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.sod_kode
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.sod_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sod_kode AND b.brgd_ukuran = d.sod_ukuran
        WHERE d.sod_so_nomor = ? ORDER BY d.sod_nourut;
    `;
  const [itemsRows] = await pool.query(itemsQuery, [soNumber]);

  return { header: headerRows[0], items: itemsRows };
};

// Fungsi untuk mengambil data Proforma yang sudah ada (mode Ubah)
const getDataForEdit = async (nomor) => {
  // Query ini adalah terjemahan dari 'loaddataall'
  const query = `
        SELECT 
            h.inv_nomor AS nomor, h.inv_tanggal AS tanggal, h.inv_nomor_so AS nomorSo, o.so_tanggal AS tanggalSo,
            h.inv_cus_kode AS customerKode, c.cus_nama AS customerNama, c.cus_alamat AS alamat, c.cus_kota AS kota, c.cus_telp AS telp,
            h.inv_cus_level AS levelKode, l.level_nama AS levelNama,
            h.inv_top AS top, h.inv_ket AS keterangan, h.inv_ppn AS ppn, h.inv_disc AS diskon, 
            h.inv_disc1 AS diskonPersen, h.inv_bkrm AS biayaKirim, h.inv_dp AS dp,
            d.invd_kode AS item_kode, d.invd_ukuran AS item_ukuran, d.invd_jumlah AS item_jumlah, 
            d.invd_harga AS item_harga, d.invd_disc AS item_diskonPersen, d.invd_diskon AS item_diskonRp,
            IFNULL(TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)), f.sd_nama) AS item_nama,
            b.brgd_barcode AS item_barcode
        FROM tinv_hdr h
        INNER JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
        LEFT JOIN tso_hdr o ON o.so_nomor = h.inv_nomor_so
        LEFT JOIN tcustomer c ON c.cus_kode = h.Inv_cus_kode
        LEFT JOIN tcustomer_level l ON l.level_kode = h.inv_cus_level
        LEFT JOIN tbarangdc a ON a.brg_kode = d.invd_kode
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.invd_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.invd_kode AND b.brgd_ukuran = d.invd_ukuran
        WHERE h.inv_sts_pro = 2 AND h.inv_nomor = ?
        ORDER BY d.invd_nourut;
    `;
  const [rows] = await pool.query(query, [nomor]);

  if (rows.length === 0) {
    throw new Error(`Proforma Invoice dengan nomor ${nomor} tidak ditemukan.`);
  }

  // Proses data menjadi format { header, items }
  const header = {
    nomor: rows[0].nomor,
    tanggal: format(new Date(rows[0].tanggal), "yyyy-MM-dd"),
    nomorSo: rows[0].nomorSo,
    tanggalSo: rows[0].tanggalSo
      ? format(new Date(rows[0].tanggalSo), "yyyy-MM-dd")
      : null,
    customerKode: rows[0].customerKode,
    customerNama: rows[0].customerNama,
    alamat: rows[0].alamat,
    kota: rows[0].kota,
    telp: rows[0].telp,
    level: `${rows[0].levelKode} - ${rows[0].levelNama}`,
    top: rows[0].top,
    keterangan: rows[0].keterangan,
    ppn: rows[0].ppn,
    diskon: rows[0].diskon,
    diskonPersen: rows[0].diskonPersen,
    biayaKirim: rows[0].biayaKirim,
    dp: rows[0].dp,
    cabang: rows[0].nomor.substring(0, 3),
  };

  const items = rows.map((row) => ({
    id: Math.random(),
    kode: row.item_kode,
    nama: row.item_nama,
    ukuran: row.item_ukuran,
    jumlah: row.item_jumlah,
    harga: row.item_harga,
    diskonPersen: row.item_diskonPersen,
    diskonRp: row.item_diskonRp,
    barcode: row.item_barcode,
  }));

  return { header, items };
};

// Fungsi untuk menyimpan data Proforma
const saveData = async (payload, user) => {
  const { header, items } = payload;
  const isEdit = !!header.nomor;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let nomorProforma = header.nomor;
    if (!isEdit) {
      nomorProforma = await generateNewNumber(
        connection,
        header.cabang,
        header.tanggal
      );
    }

    // Hapus detail lama jika mode edit
    if (isEdit) {
      await connection.query("DELETE FROM tinv_dtl WHERE invd_inv_nomor = ?", [
        nomorProforma,
      ]);
    }

    // Simpan header (INSERT atau UPDATE)
    const headerData = {
      Inv_tanggal: header.tanggal,
      Inv_nomor_so: header.nomorSo,
      inv_cus_level: header.level,
      Inv_top: header.top,
      inv_ppn: header.ppn,
      inv_disc: header.diskon,
      inv_disc1: header.diskonPersen,
      inv_bkrm: header.biayaKirim,
      inv_dp: header.dp,
      Inv_cus_kode: header.customerKode,
      Inv_ket: header.keterangan,
      inv_sts_pro: 2, // Proforma
    };

    if (isEdit) {
      headerData.user_modified = user.kode;
      headerData.date_modified = new Date();
      headerData.inv_cab = header.cabang;
      await connection.query("UPDATE tinv_hdr SET ? WHERE inv_nomor = ?", [
        headerData,
        nomorProforma,
      ]);
    } else {
      headerData.inv_nomor = nomorProforma;
      headerData.inv_cab = header.cabang;
      headerData.user_create = user.kode;
      headerData.date_create = new Date();
      await connection.query("INSERT INTO tinv_hdr SET ?", headerData);
    }

    // Simpan detail
    for (const [index, item] of items.entries()) {
      if (item.kode && item.jumlah > 0) {
        const itemData = {
          Invd_Inv_nomor: nomorProforma,
          Invd_kode: item.kode,
          invd_ukuran: item.ukuran,
          Invd_jumlah: item.jumlah,
          invd_harga: item.harga,
          invd_disc: item.diskonPersen,
          invd_diskon: item.diskonRp,
          invd_nourut: index + 1,
        };
        await connection.query("INSERT INTO tinv_dtl SET ?", itemData);
      }
    }

    await connection.commit();
    return {
      message: `Proforma berhasil disimpan dengan nomor ${nomorProforma}`,
      nomor: nomorProforma,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const lookupSO = async (filters) => {
  const { cabang, term, page = 1, itemsPerPage = 10 } = filters;
  const offset = (page - 1) * itemsPerPage;

  // Ini adalah terjemahan dari query 'bantuanso' di Delphi
  const baseQuery = `
        FROM (
            SELECT 
                h.so_nomor AS Nomor, h.so_tanggal AS Tanggal, h.so_cus_kode AS KdCus, 
                c.Cus_nama AS Customer, c.Cus_alamat AS Alamat, c.cus_kota AS Kota,
                IFNULL((SELECT SUM(dd.sod_jumlah) FROM tso_dtl dd WHERE dd.sod_so_nomor = h.so_nomor), 0) AS qtyso,
                IFNULL((SELECT SUM(dd.invd_jumlah) FROM tinv_dtl dd JOIN tinv_hdr hh ON hh.inv_nomor = dd.invd_inv_nomor WHERE hh.inv_nomor_so = h.so_nomor), 0) AS qtyinv
            FROM tso_hdr h
            LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
            WHERE h.so_aktif = "Y" AND h.so_close = 0 AND h.so_cab = ?
        ) x
        WHERE x.qtyinv < x.qtyso
    `;

  let params = [cabang];
  let searchTermCondition = "";
  if (term) {
    searchTermCondition = "AND (x.Nomor LIKE ? OR x.Customer LIKE ?)";
    const searchTermVal = `%${term}%`;
    params.push(searchTermVal, searchTermVal);
  }

  const countQuery = `SELECT COUNT(*) as total ${baseQuery} ${searchTermCondition}`;
  const [countRows] = await pool.query(countQuery, params);
  const total = countRows[0].total;

  const dataQuery = `SELECT x.Nomor, x.Tanggal, x.KdCus, x.Customer ${baseQuery} ${searchTermCondition} ORDER BY x.Nomor DESC LIMIT ? OFFSET ?`;
  const dataParams = [...params, parseInt(itemsPerPage), parseInt(offset)];
  const [items] = await pool.query(dataQuery, dataParams);

  return { items, total };
};

const getPrintData = async (nomor) => {
  const query = `
        SELECT 
            h.inv_nomor AS nomor, h.inv_tanggal AS tanggal, h.inv_top AS top, 
            DATE_ADD(h.inv_tanggal, INTERVAL h.inv_top DAY) as tempo,
            h.inv_cus_kode AS cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp,
            CONCAT(h.inv_cus_level," - ",l.level_nama) AS xlevel,
            h.inv_ket AS ket, h.inv_ppn AS ppn, h.inv_disc AS diskon, h.inv_disc1 AS persen,
            (SELECT SUM(x.invd_jumlah * x.invd_harga) FROM tinv_dtl x WHERE x.invd_inv_nomor = h.inv_nomor) AS total,
            h.inv_bkrm AS biayakirim, h.inv_dp AS dprp,
            d.invd_kode AS kode, 
            IFNULL(TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)), f.sd_nama) AS nama,
            d.invd_ukuran AS ukuran, d.invd_jumlah AS jumlah, d.invd_harga AS harga,
            d.invd_disc AS dis, d.invd_diskon AS disrp,
            (d.invd_jumlah * d.invd_harga) AS subtotal,
            h.user_create AS user_nama,
            DATE_FORMAT(h.date_create, "%d-%m-%Y %T") AS created,
            g.gdg_inv_nama, g.gdg_inv_alamat, g.gdg_inv_kota, g.gdg_inv_telp
        FROM tinv_hdr h
        JOIN tinv_dtl d ON h.inv_nomor = d.invd_inv_nomor
        LEFT JOIN tcustomer c ON h.inv_cus_kode = c.cus_kode
        LEFT JOIN tcustomer_level l ON h.inv_cus_level = l.level_kode
        LEFT JOIN tbarangdc a ON d.invd_kode = a.brg_kode
        LEFT JOIN tsodtf_hdr f ON d.invd_kode = f.sd_nomor
        LEFT JOIN tgudang g ON h.inv_cab = g.gdg_kode
        WHERE h.inv_nomor = ?
        ORDER BY d.invd_nourut;
    `;
  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) throw new Error("Data cetak tidak ditemukan.");

  // Ambil fungsi terbilang jika ada
  const totalNetto =
    rows[0].total -
    rows[0].diskon +
    (rows[0].ppn / 100) * (rows[0].total - rows[0].diskon);
  const [terbilangRows] = await pool.query("SELECT terbilang(?) AS bilang", [
    totalNetto,
  ]);

  const header = { ...rows[0], bilang: terbilangRows[0].bilang };
  delete header.kode; // Hapus field duplikat dari header
  // ... hapus field item lain dari header

  const details = rows.map((row) => ({
    kode: row.kode,
    nama: row.nama,
    ukuran: row.ukuran,
    jumlah: row.jumlah,
    harga: row.harga,
    dis: row.dis,
    subtotal: row.subtotal,
  }));

  return { header, details };
};

module.exports = {
  getDataFromSO,
  getDataForEdit,
  saveData,
  lookupSO,
  getPrintData,
};
