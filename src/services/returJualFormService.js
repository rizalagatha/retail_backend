const pool = require("../config/database");

// Fungsi untuk memuat data dari invoice yang dipilih (meniru edtinvExit)
const loadFromInvoice = async (nomorInvoice) => {
  const query = `
        SELECT 
            h.inv_nomor, h.inv_tanggal, h.inv_cus_kode, h.inv_ppn, h.inv_disc, h.inv_disc1, h.inv_disc2,
            c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp,
            d.invd_kode, d.invd_ukuran, d.invd_jumlah, d.invd_harga, d.invd_disc, d.invd_diskon,
            b.brgd_barcode,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama_barang,
            -- Menghitung jumlah yang sudah pernah diretur untuk item ini (meniru getsudah)
            (SELECT IFNULL(SUM(rd.rjd_jumlah), 0) FROM trj_dtl rd JOIN trj_hdr rh ON rd.rjd_nomor = rh.rj_nomor WHERE rh.rj_inv = h.inv_nomor AND rd.rjd_kode = d.invd_kode AND rd.rjd_ukuran = d.invd_ukuran) AS sudah_retur
        FROM tinv_hdr h
        INNER JOIN tinv_dtl d ON d.invd_inv_nomor = h.inv_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
        LEFT JOIN tbarangdc a ON a.brg_kode = d.invd_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.invd_kode AND b.brgd_ukuran = d.invd_ukuran
        WHERE h.inv_nomor = ?;
    `;
  const [rows] = await pool.query(query, [nomorInvoice]);
  if (rows.length === 0) throw new Error("Invoice tidak ditemukan.");

  const header = {
    invoice: rows[0].inv_nomor,
    customer: {
      kode: rows[0].inv_cus_kode,
      nama: rows[0].cus_nama,
      alamat: rows[0].cus_alamat,
      kota: rows[0].cus_kota,
      telp: rows[0].cus_telp,
    },
    ppnPersen: rows[0].inv_ppn,
    diskonRp: rows[0].inv_disc,
    diskonPersen1: rows[0].inv_disc1,
    diskonPersen2: rows[0].inv_disc2,
  };
  const items = rows.map((row) => ({
    kode: row.invd_kode,
    nama: row.nama_barang,
    ukuran: row.invd_ukuran,
    barcode: row.brgd_barcode,
    qtyInv: row.invd_jumlah,
    harga: row.invd_harga,
    disc: row.invd_disc, // disc % dari invoice
    diskon: row.invd_diskon, // disc Rp dari invoice
    sudah: row.sudah_retur,
  }));

  return { header, items };
};

// Fungsi untuk menyimpan data Retur Jual
const save = async (payload, user) => {
  const { header, items, footer, isNew } = payload;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let nomorDokumen = header.nomor;
    if (isNew) {
      const d = new Date(header.tanggal);
      const year = String(d.getFullYear()).slice(2);
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const yearMonth = `${year}${month}`;
      const prefix = `${header.cabangKode}.RJ.${yearMonth}.`;

      const nomorQuery = `
        SELECT IFNULL(MAX(CAST(RIGHT(rj_nomor, 4) AS UNSIGNED)), 0) + 1 AS next_num
        FROM trj_hdr
        WHERE rj_nomor LIKE CONCAT(?, '%')
      `;
      const [nomorRows] = await connection.query(nomorQuery, [prefix]);
      const nextNum = nomorRows[0].next_num || 1;
      nomorDokumen = `${prefix}${String(nextNum).padStart(4, "0")}`;

      console.log("Generate nomorDokumen =>", nomorDokumen, {
        prefix,
        nextNum,
      });

      const headerInsertQuery = `
        INSERT INTO trj_hdr (
        rj_nomor, rj_inv, rj_jenis, rj_tanggal, 
        rj_ppn, rj_disc, rj_cus_kode, rj_ket, 
        rj_cab,
        user_create, date_create
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;
      // Gunakan footer.diskonRp untuk kolom rj_disc
      await connection.query(headerInsertQuery, [
        nomorDokumen,
        header.invoice,
        header.jenis,
        header.tanggal,
        header.ppnPersen,
        footer.diskonRp,
        header.customer.kode,
        header.keterangan,
        header.cabangKode,
        user.kode,
      ]);
    } else {
      const headerUpdateQuery = `
        UPDATE trj_hdr SET 
            rj_tanggal = ?, rj_ppn = ?, rj_disc = ?, rj_ket = ?, 
            user_modified = ?, date_modified = NOW() 
        WHERE rj_nomor = ?
      `;
      await connection.query(headerUpdateQuery, [
        header.tanggal,
        header.ppnPersen,
        footer.diskonRp,
        header.keterangan,
        user.kode,
        nomorDokumen,
      ]);
    }

    await connection.query("DELETE FROM trj_dtl WHERE rjd_nomor = ?", [
      nomorDokumen,
    ]);

    if (items.length > 0) {
      const itemValues = items.map((item, index) => [
        nomorDokumen,
        item.kode,
        item.ukuran,
        item.jumlah,
        item.harga,
        item.disc,
        item.diskon,
        index + 1,
      ]);
      await connection.query(
        "INSERT INTO trj_dtl (rjd_nomor, rjd_kode, rjd_ukuran, rjd_jumlah, rjd_harga, rjd_disc, rjd_diskon, rjd_nourut) VALUES ?",
        [itemValues]
      );
    }

    // Link ke piutang jika jenis retur 'Salah Qty'
    if (header.jenis === "Y") {
      const piutangHeaderNomor = `${header.customer.kode}${header.invoice}`;
      await connection.query(
        `INSERT INTO tpiutang_dtl (pd_ph_nomor, pd_tanggal, pd_uraian, pd_kredit, pd_ket) VALUES (?, ?, 'Pembayaran Retur', ?, ?)
                 ON DUPLICATE KEY UPDATE pd_kredit = VALUES(pd_kredit)`,
        [
          piutangHeaderNomor,
          header.tanggal,
          payload.footer.grandTotal,
          nomorDokumen,
        ]
      );
    }

    await connection.commit();
    return {
      message: `Retur Jual berhasil disimpan dengan nomor ${nomorDokumen}`,
      nomor: nomorDokumen,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// Fungsi untuk lookup invoice (meniru F1 di edtinv)
const lookupInvoices = async (cabang) => {
  const query = `
    SELECT h.inv_nomor AS nomor, h.inv_tanggal AS tanggal, c.cus_nama
    FROM tinv_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
    WHERE h.inv_cab = ? 
        AND h.inv_tanggal >= DATE_SUB(NOW(), INTERVAL 7 DAY) -- Filter 7 hari terakhir agar tidak terlalu berat
    ORDER BY h.inv_nomor DESC;
    `;
  const [rows] = await pool.query(query, [cabang]);
  return rows;
};

const findByBarcode = async (barcode) => {
  // Query ini meniru 'loadbrg' di Delphi untuk scan barcode
  const query = `
    SELECT 
        b.brgd_kode AS kode,
        b.brgd_barcode AS barcode,
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
        b.brgd_ukuran AS ukuran,
        b.brgd_harga AS harga
    FROM tbarangdc_dtl b
    INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
    WHERE a.brg_aktif = 0 AND b.brgd_barcode = ?;
  `;
  const [rows] = await pool.query(query, [barcode]);
  if (rows.length === 0) {
    throw new Error("Barcode tidak ditemukan atau barang tidak aktif.");
  }
  return rows[0];
};

function terbilang(n) {
  if (n === null || n === undefined || isNaN(n)) return "Nol";
  n = Math.floor(Math.abs(n));

  const ang = [
    "",
    "satu",
    "dua",
    "tiga",
    "empat",
    "lima",
    "enam",
    "tujuh",
    "delapan",
    "sembilan",
    "sepuluh",
    "sebelas",
  ];

  const terbilangRecursive = (num) => {
    if (num < 12) return ang[num];
    if (num < 20) return terbilangRecursive(num - 10) + " belas";
    if (num < 100)
      return (
        (ang[Math.floor(num / 10)] || "") +
        " puluh " +
        terbilangRecursive(num % 10)
      );
    if (num < 200) return "seratus " + terbilangRecursive(num - 100);
    if (num < 1000)
      return (
        terbilangRecursive(Math.floor(num / 100)) +
        " ratus " +
        terbilangRecursive(num % 100)
      );
    if (num < 2000) return "seribu " + terbilangRecursive(num - 1000);
    if (num < 1000000)
      return (
        terbilangRecursive(Math.floor(num / 1000)) +
        " ribu " +
        terbilangRecursive(num % 1000)
      );
    if (num < 1000000000)
      return (
        terbilangRecursive(Math.floor(num / 1000000)) +
        " juta " +
        terbilangRecursive(num % 1000000)
      );
    return "angka terlalu besar";
  };

  const result = terbilangRecursive(n).replace(/\s+/g, " ").trim();
  return result.charAt(0).toUpperCase() + result.slice(1); // Langsung kapitalisasi
}

const getPrintData = async (nomor) => {
  const query = `
    SELECT 
        h.rj_nomor, h.rj_tanggal, h.rj_inv, h.rj_ket,
        DATE_FORMAT(h.date_create, '%d-%m-%Y %H:%i:%s') AS created,
        h.user_create,
        c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp,
        d.rjd_kode,
        TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama_barang,
        d.rjd_ukuran, d.rjd_jumlah, d.rjd_harga, d.rjd_diskon,
        (d.rjd_jumlah * (d.rjd_harga - d.rjd_diskon)) AS total_item,
        g.gdg_inv_nama, g.gdg_inv_alamat, g.gdg_inv_kota, g.gdg_inv_telp,
        -- Subquery untuk subtotal, diskon, dan grand total
        (SELECT SUM(d2.rjd_jumlah * (d2.rjd_harga - d2.rjd_diskon)) FROM trj_dtl d2 WHERE d2.rjd_nomor = h.rj_nomor) AS subtotal,
        h.rj_disc AS diskon_header,
        h.rj_ppn AS ppn_persen
    FROM trj_hdr h
    LEFT JOIN trj_dtl d ON d.rjd_nomor = h.rj_nomor
    LEFT JOIN tcustomer c ON c.cus_kode = h.rj_cus_kode
    LEFT JOIN tbarangdc a ON a.brg_kode = d.rjd_kode
    LEFT JOIN tgudang g ON g.gdg_kode = h.rj_cab
    WHERE h.rj_nomor = ?;
    `;
  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) throw new Error("Data untuk dicetak tidak ditemukan.");

  const subtotal = Number(rows[0].subtotal) || 0;
  const diskonHeader = Number(rows[0].diskon_header) || 0;
  const ppnPersen = Number(rows[0].ppn_persen) || 0;
  const netto = subtotal - diskonHeader;
  const ppnRp = (ppnPersen / 100) * netto;
  const grandTotal = netto + ppnRp;

  const header = {
    nomor: rows[0].rj_nomor,
    tanggal: rows[0].rj_tanggal,
    invoice: rows[0].rj_inv,
    keterangan: rows[0].rj_ket,
    created: rows[0].created,
    user_create: rows[0].user_create,
    customer: {
      nama: rows[0].cus_nama,
      alamat: rows[0].cus_alamat,
      kota: rows[0].cus_kota,
      telp: rows[0].cus_telp,
    },
    gudang: {
      nama: rows[0].gdg_inv_nama,
      alamat: rows[0].gdg_inv_alamat,
      kota: rows[0].gdg_inv_kota,
      telp: rows[0].gdg_inv_telp,
    },
    summary: {
      subtotal,
      diskon: diskonHeader,
      ppn: ppnRp,
      grandTotal,
      terbilang: terbilang(grandTotal) + " Rupiah",
    },
  };
  const details = rows
    .filter((r) => r.rjd_kode)
    .map((r) => ({
      kode: r.rjd_kode,
      nama: r.nama_barang,
      ukuran: r.rjd_ukuran,
      jumlah: r.rjd_jumlah,
      harga: r.rjd_harga,
      diskon: r.rjd_diskon,
      total: r.total_item,
    }));

  return { header, details };
};

const getForEdit = async (nomorRetur) => {
  // 1. Ambil data header retur
  const headerQuery = `
    SELECT h.*, c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp 
    FROM trj_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.rj_cus_kode
    WHERE h.rj_nomor = ?;
    `;
  const [headerRows] = await pool.query(headerQuery, [nomorRetur]);
  if (headerRows.length === 0) throw new Error("Retur Jual tidak ditemukan.");
  const returHeader = headerRows[0];
  const nomorInvoice = returHeader.rj_inv;

  // 2. Ambil semua item dari INVOICE ASLI
  const invoiceItemsQuery = `
    SELECT 
        d.invd_kode AS kode, d.invd_ukuran AS ukuran,
        TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
        b.brgd_barcode AS barcode,
        d.invd_jumlah AS qtyInv,
        d.invd_harga AS harga,
        d.invd_disc AS disc,
        d.invd_diskon AS diskon,
        (SELECT IFNULL(SUM(rd.rjd_jumlah), 0) FROM trj_dtl rd JOIN trj_hdr rh ON rd.rjd_nomor = rh.rj_nomor WHERE rh.rj_inv = ? AND rd.rjd_kode = d.invd_kode AND rd.rjd_ukuran = d.invd_ukuran AND rd.rjd_nomor <> ?) AS sudah_retur
    FROM tinv_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.invd_kode
    LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.invd_kode AND b.brgd_ukuran = d.invd_ukuran
    WHERE d.invd_inv_nomor = ?;
    `;
  const [invoiceItems] = await pool.query(invoiceItemsQuery, [
    nomorInvoice,
    nomorRetur,
    nomorInvoice,
  ]);

  // 3. Ambil item yang sudah diretur di DOKUMEN INI
  const returnedItemsQuery = `SELECT rjd_kode, rjd_ukuran, rjd_jumlah FROM trj_dtl WHERE rjd_nomor = ?;`;
  const [returnedItems] = await pool.query(returnedItemsQuery, [nomorRetur]);
  const returnedMap = new Map(
    returnedItems.map((item) => [
      `${item.rjd_kode}-${item.rjd_ukuran}`,
      item.rjd_jumlah,
    ])
  );

  // 4. Gabungkan data: Isi 'jumlah' retur dari data retur ke daftar item invoice
  const finalItems = invoiceItems.map((item) => ({
    ...item,
    jumlah: returnedMap.get(`${item.kode}-${item.ukuran}`) || 0,
    sudah: item.sudah_retur,
  }));

  const headerData = {
    nomor: returHeader.rj_nomor,
    tanggal: returHeader.rj_tanggal,
    invoice: returHeader.rj_inv,
    customer: {
      kode: returHeader.rj_cus_kode,
      nama: returHeader.cus_nama,
      alamat: returHeader.cus_alamat,
      kota: returHeader.cus_kota,
      telp: returHeader.cus_telp,
    },
    jenis: returHeader.rj_jenis,
    keterangan: returHeader.rj_ket,
    ppnPersen: returHeader.rj_ppn,
    diskonRp: returHeader.rj_disc,
    diskonPersen1: returHeader.rj_disc1,
    diskonPersen2: returHeader.rj_disc2,
  };

  return { header: headerData, items: finalItems };
};

module.exports = {
  loadFromInvoice,
  save,
  lookupInvoices,
  findByBarcode,
  getPrintData,
  getForEdit,
};
