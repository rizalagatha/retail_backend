const pool = require("../config/database");
const { format, addDays } = require("date-fns");

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
        WHERE h.so_nomor = ? AND h.so_cab = ?;
    `;
  const [headerRows] = await pool.query(headerQuery, [soNumber, branchCode]);
  if (headerRows.length === 0) throw new Error("Nomor SO tidak ditemukan.");

  const itemsQuery = `
        SELECT 
            d.sod_kode AS kode, d.sod_ukuran AS ukuran, d.sod_jumlah AS jumlah, d.sod_harga AS harga,
            d.sod_disc AS diskonPersen, d.sod_diskon AS diskonRp,
            IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), f.sd_nama) AS nama,
            (SELECT brgd_barcode FROM tbarangdc_dtl WHERE brgd_kode = d.sod_kode AND brgd_ukuran = d.sod_ukuran LIMIT 1) AS barcode
        FROM tso_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.sod_kode
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.sod_kode
        WHERE d.sod_so_nomor = ? ORDER BY d.sod_nourut;
    `;
  const [itemsRows] = await pool.query(itemsQuery, [soNumber]);

  return { header: headerRows[0], items: itemsRows };
};

// Memanggil invoice sebagai sumber Proforma (alternatif selain SO)
const getDataFromInvoice = async (nomorInv, branchCode) => {
  const headerQuery = `
        SELECT 
            h.inv_nomor_so AS nomorSo, o.so_tanggal AS tanggalSo,
            h.inv_cus_kode AS customerKode, c.cus_nama AS customerNama, c.cus_alamat AS alamat, c.cus_kota AS kota, c.cus_telp AS telp,
            h.inv_cus_level AS levelKode, l.level_nama AS levelNama,
            h.inv_top AS top, h.inv_ppn AS ppn, h.inv_disc AS diskon, h.inv_disc1 AS diskonPersen,
            h.inv_bkrm AS biayaKirim, h.inv_dp AS dp
        FROM tinv_hdr h
        LEFT JOIN tso_hdr o ON o.so_nomor = h.inv_nomor_so
        LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
        LEFT JOIN tcustomer_level l ON l.level_kode = h.inv_cus_level
        WHERE h.inv_nomor = ? AND h.inv_cab = ? AND h.inv_sts_pro <> 2;
    `;
  const [headerRows] = await pool.query(headerQuery, [nomorInv, branchCode]);
  if (headerRows.length === 0)
    throw new Error("Nomor Invoice tidak ditemukan.");

  const itemsQuery = `
        SELECT 
            d.invd_kode AS kode, d.invd_ukuran AS ukuran, d.invd_jumlah AS jumlah, d.invd_harga AS harga,
            d.invd_disc AS diskonPersen, d.invd_diskon AS diskonRp,
            IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), f.sd_nama) AS nama,
            (SELECT brgd_barcode FROM tbarangdc_dtl WHERE brgd_kode = d.invd_kode AND brgd_ukuran = d.invd_ukuran LIMIT 1) AS barcode
        FROM tinv_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.invd_kode
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.invd_kode
        WHERE d.invd_inv_nomor = ? ORDER BY d.invd_nourut;
    `;
  const [itemsRows] = await pool.query(itemsQuery, [nomorInv]);

  return { header: headerRows[0], items: itemsRows };
};

// Fungsi untuk mengambil data Proforma yang sudah ada (mode Ubah)
const getDataForEdit = async (nomor) => {
  // Query ini adalah terjemahan dari 'loaddataall' (sudah dioptimasi Anti-Dobel)
  const query = `
        SELECT 
            h.inv_nomor AS nomor, h.inv_tanggal AS tanggal, h.inv_nomor_so AS nomorSo, o.so_tanggal AS tanggalSo,
            h.inv_cus_kode AS customerKode, c.cus_nama AS customerNama, c.cus_alamat AS alamat, c.cus_kota AS kota, c.cus_telp AS telp,
            h.inv_cus_level AS levelKode, l.level_nama AS levelNama,
            h.inv_top AS top, h.inv_ket AS keterangan, h.inv_ppn AS ppn, h.inv_disc AS diskon, 
            h.inv_disc1 AS diskonPersen, h.inv_bkrm AS biayaKirim, h.inv_dp AS dp,
            h.inv_ref_inv_nomor AS refInvoice, h.inv_status_acc AS statusAcc,
            d.invd_kode AS item_kode, d.invd_ukuran AS item_ukuran, d.invd_jumlah AS item_jumlah, 
            d.invd_harga AS item_harga, d.invd_disc AS item_diskonPersen, d.invd_diskon AS item_diskonRp,
            IFNULL(TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)), f.sd_nama) AS item_nama,
            
            -- [PERBAIKAN]: Ambil HANYA SATU barcode pakai subquery untuk menghindari row ganda (double data)
            (SELECT brgd_barcode FROM tbarangdc_dtl WHERE brgd_kode = d.invd_kode AND brgd_ukuran = d.invd_ukuran LIMIT 1) AS item_barcode

        FROM tinv_hdr h
        INNER JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
        LEFT JOIN tso_hdr o ON o.so_nomor = h.inv_nomor_so
        LEFT JOIN tcustomer c ON c.cus_kode = h.Inv_cus_kode
        LEFT JOIN tcustomer_level l ON l.level_kode = h.inv_cus_level
        LEFT JOIN tbarangdc a ON a.brg_kode = d.invd_kode
        LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.invd_kode
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
    tempo: format(
      addDays(new Date(rows[0].tanggal), Number(rows[0].top) || 0),
      "yyyy-MM-dd",
    ),
    refInvoice: rows[0].refInvoice || "",
    statusAcc: rows[0].statusAcc || "",
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

const angka = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const kunciBaris = (kode, ukuran) => `${kode}|${String(ukuran ?? "")}`;

// Harga acuan dari sumber (SO atau invoice referensi). Harga dari client tidak dipercaya.
const loadSumber = async (connection, { nomorSo, refInvoice, cabang }) => {
  const harga = new Map();
  let soAsal = nomorSo;

  if (refInvoice) {
    const [rows] = await connection.query(
      `SELECT h.inv_nomor_so, d.invd_kode AS kode, d.invd_ukuran AS ukuran, d.invd_harga AS harga
       FROM tinv_hdr h
       JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
       WHERE h.inv_nomor = ? AND h.inv_cab = ? AND h.inv_sts_pro <> 2`,
      [refInvoice, cabang],
    );
    if (rows.length === 0)
      throw new Error(`Invoice referensi ${refInvoice} tidak ditemukan.`);
    soAsal = rows[0].inv_nomor_so;
    rows.forEach((r) => {
      const k = kunciBaris(r.kode, r.ukuran);
      if (!harga.has(k)) harga.set(k, angka(r.harga));
    });
  } else {
    const [rows] = await connection.query(
      `SELECT d.sod_kode AS kode, d.sod_ukuran AS ukuran, d.sod_harga AS harga
       FROM tso_hdr h
       JOIN tso_dtl d ON d.sod_so_nomor = h.so_nomor
       WHERE h.so_nomor = ? AND h.so_cab = ?`,
      [nomorSo, cabang],
    );
    if (rows.length === 0) throw new Error(`SO ${nomorSo} tidak ditemukan.`);
    rows.forEach((r) => {
      const k = kunciBaris(r.kode, r.ukuran);
      if (!harga.has(k)) harga.set(k, angka(r.harga));
    });
  }
  return { harga, soAsal };
};

// Fungsi untuk menyimpan data Proforma. Setiap simpan (baru/ubah) berstatus MENUNGGU ACC.
const saveData = async (payload, user) => {
  const { header, items } = payload;
  const isEdit = !!header.nomor;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let nomorProforma = header.nomor;
    let cabang = header.cabang;
    let nomorSo = String(header.nomorSo || "").trim();
    let refInvoice = String(header.refInvoice || "").trim();
    const hargaLama = new Map();

    if (isEdit) {
      // Sumber & cabang dibaca dari dokumen yang tersimpan, bukan dari payload
      const [lama] = await connection.query(
        "SELECT inv_cab, inv_nomor_so, inv_ref_inv_nomor FROM tinv_hdr WHERE inv_nomor = ? AND inv_sts_pro = 2 FOR UPDATE",
        [nomorProforma],
      );
      if (lama.length === 0)
        throw new Error(`Proforma ${nomorProforma} tidak ditemukan.`);
      cabang = lama[0].inv_cab;
      nomorSo = lama[0].inv_nomor_so;
      refInvoice = lama[0].inv_ref_inv_nomor;

      const [rowsLama] = await connection.query(
        "SELECT invd_kode, invd_ukuran, invd_harga FROM tinv_dtl WHERE invd_inv_nomor = ?",
        [nomorProforma],
      );
      rowsLama.forEach((r) =>
        hargaLama.set(
          kunciBaris(r.invd_kode, r.invd_ukuran),
          angka(r.invd_harga),
        ),
      );
    }

    if (!nomorSo && !refInvoice)
      throw new Error("Sumber (SO atau Invoice) harus diisi.");
    if (!header.tanggal) throw new Error("Tanggal harus diisi.");
    if (!header.customerKode) throw new Error("Customer harus diisi.");

    const sumber = await loadSumber(connection, {
      nomorSo,
      refInvoice,
      cabang,
    });

    // ── Validasi detail ──
    const validItems = (items || []).filter(
      (i) => i.kode && angka(i.jumlah) > 0,
    );
    if (validItems.length === 0) {
      throw new Error("Minimal satu barang dengan jumlah lebih dari 0.");
    }
    const rows = validItems.map((it) => {
      const k = kunciBaris(it.kode, it.ukuran);
      const hargaSumber = sumber.harga.get(k);
      if (hargaSumber === undefined) {
        throw new Error(
          `Barang ${it.kode} (${it.ukuran}) tidak ada di sumber.`,
        );
      }
      const harga = angka(it.harga);
      const sama = (a, b) => Math.abs(a - b) < 0.005;
      const boleh =
        sama(harga, hargaSumber) ||
        (hargaLama.has(k) && sama(harga, hargaLama.get(k)));
      if (!boleh)
        throw new Error(`Harga ${it.kode} (${it.ukuran}) tidak boleh diubah.`);

      const jumlah = angka(it.jumlah);
      const diskonPersen = angka(it.diskonPersen);
      const diskonRp = angka(it.diskonRp);
      if (diskonPersen < 0 || diskonPersen > 100) {
        throw new Error(
          `Diskon % ${it.kode} (${it.ukuran}) harus antara 0 dan 100.`,
        );
      }
      if (diskonRp < 0 || diskonRp > jumlah * harga + 0.005) {
        throw new Error(`Diskon Rp ${it.kode} (${it.ukuran}) tidak valid.`);
      }
      return {
        kode: it.kode,
        ukuran: it.ukuran,
        jumlah,
        harga,
        diskonPersen,
        diskonRp,
      };
    });

    // ── Validasi header & total (cermin hitungan di form) ──
    const top = angka(header.top);
    const ppn = angka(header.ppn);
    const diskon = angka(header.diskon);
    const diskonPersen = angka(header.diskonPersen);
    const biayaKirim = angka(header.biayaKirim);
    const dp = angka(header.dp);
    if (top < 0) throw new Error("TOP tidak boleh negatif.");
    if (ppn < 0 || ppn > 100)
      throw new Error("PPN (%) harus antara 0 dan 100.");
    if (diskonPersen < 0 || diskonPersen > 100)
      throw new Error("Diskon (%) harus antara 0 dan 100.");
    if (diskon < 0 || biayaKirim < 0 || dp < 0) {
      throw new Error("Diskon, biaya kirim, dan DP tidak boleh negatif.");
    }
    const subtotal = rows.reduce((t, r) => t + r.jumlah * r.harga, 0);
    const setelahItem = subtotal - rows.reduce((t, r) => t + r.diskonRp, 0);
    const dpp = setelahItem - (setelahItem * (diskonPersen / 100) + diskon);
    const netto = dpp + dpp * (ppn / 100) + biayaKirim - dp;
    if (dpp < -0.005) throw new Error("Total diskon melebihi subtotal.");
    if (netto < -0.005)
      throw new Error("DP melebihi total tagihan (netto negatif).");

    if (!isEdit) {
      nomorProforma = await generateNewNumber(
        connection,
        cabang,
        header.tanggal,
      );
    }

    // Potong string level: "1 - DISTRIBUTOR" -> "1"
    const levelKodeOlah = header.level
      ? header.level.split(" - ")[0].trim()
      : null;

    const headerData = {
      Inv_tanggal: header.tanggal,
      inv_cus_level: levelKodeOlah,
      Inv_top: top,
      inv_ppn: ppn,
      inv_disc: diskon,
      inv_disc1: diskonPersen,
      inv_bkrm: biayaKirim,
      inv_dp: dp,
      Inv_cus_kode: header.customerKode,
      Inv_ket: header.keterangan,
      inv_sts_pro: 2, // Proforma
      inv_status_acc: "MENUNGGU", // setiap simpan butuh ACC Manager Retail
    };

    if (isEdit) {
      headerData.user_modified = user.kode;
      headerData.date_modified = new Date();
      await connection.query("UPDATE tinv_hdr SET ? WHERE inv_nomor = ?", [
        headerData,
        nomorProforma,
      ]);
      await connection.query("DELETE FROM tinv_dtl WHERE invd_inv_nomor = ?", [
        nomorProforma,
      ]);

      // Permintaan ACC lama untuk dokumen ini gugur: yang berlaku hanya yang terbaru
      await connection.query(
        `UPDATE totorisasi SET o_status = 'N', o_approver = 'SISTEM', o_approved_at = NOW()
         WHERE o_jenis = 'PROFORMA' AND o_transaksi = ? AND o_status = 'P'`,
        [nomorProforma],
      );
    } else {
      headerData.inv_nomor = nomorProforma;
      headerData.Inv_nomor_so = sumber.soAsal;
      headerData.inv_ref_inv_nomor = refInvoice;
      headerData.inv_idrec = `${cabang}INV${format(new Date(), "yyyyMMddHHmmss.SSS")}`;
      headerData.inv_cab = cabang;
      headerData.user_create = user.kode;
      headerData.date_create = new Date();
      await connection.query("INSERT INTO tinv_hdr SET ?", headerData);
    }

    // Simpan detail
    for (const [index, r] of rows.entries()) {
      const detailIdrec = `${cabang}IND${format(new Date(), "yyyyMMddHHmmss.SSS")}${index}`;
      await connection.query("INSERT INTO tinv_dtl SET ?", {
        invd_idrec: detailIdrec,
        Invd_Inv_nomor: nomorProforma,
        Invd_kode: r.kode,
        invd_ukuran: r.ukuran,
        Invd_jumlah: r.jumlah,
        invd_harga: r.harga,
        invd_disc: r.diskonPersen,
        invd_diskon: r.diskonRp,
        invd_nourut: index + 1,
      });
    }

    await connection.commit();
    return {
      message: `Proforma ${nomorProforma} tersimpan dan menunggu ACC Manager Retail.`,
      nomor: nomorProforma,
      statusAcc: "MENUNGGU",
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

// Daftar invoice untuk lookup Proforma. Modal memfilter di sisi client,
// jadi hasilnya dibatasi 500 invoice terbaru dari cabang user.
const lookupInvoice = async (cabang) => {
  const [rows] = await pool.query(
    `SELECT h.inv_nomor AS Nomor, h.inv_tanggal AS Tanggal, h.inv_nomor_so AS NomorSo,
            h.inv_cus_kode AS KdCus, c.cus_nama AS Customer
     FROM tinv_hdr h
     LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
     WHERE h.inv_cab = ? AND h.inv_sts_pro <> 2
     ORDER BY h.inv_tanggal DESC, h.inv_nomor DESC
     LIMIT 500`,
    [cabang],
  );
  return rows;
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

// Info ringkas untuk gerbang akses (cabang pemilik + status ACC).
// Null kalau nomor bukan proforma atau tidak ada.
const getInfoAkses = async (nomor) => {
  const [rows] = await pool.query(
    "SELECT inv_cab AS cabang, inv_status_acc AS statusAcc FROM tinv_hdr WHERE inv_nomor = ? AND inv_sts_pro = 2",
    [nomor],
  );
  return rows[0] || null;
};

module.exports = {
  getDataFromSO,
  getDataFromInvoice,
  getDataForEdit,
  saveData,
  lookupSO,
  lookupInvoice,
  getPrintData,
  getInfoAkses,
};
