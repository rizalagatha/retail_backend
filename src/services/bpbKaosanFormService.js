const pool = require("../config/database");
const { format, parseISO } = require("date-fns");

// Helper: getmaxnomor
const generateNewNumber = async (connection, date, gudang) => {
  const tahun = format(new Date(date), "yyyy");
  const prefix = `${gudang}.BPB.${tahun}`;
  const [rows] = await connection.query(
    "SELECT IFNULL(MAX(RIGHT(bpb_nomor, 5)), 0) as max_nomor FROM retail.tdc_bpb_hdr WHERE LEFT(bpb_nomor, 12) = ?",
    [prefix]
  );
  const nextNum = parseInt(rows[0].max_nomor, 10) + 1;
  return `${prefix}${String(100000 + nextNum).slice(-5)}`;
};

// Helper: getsudah (Penerimaan BPB sebelumnya)
const getSudahDiterima = async (nomorPO, kode, ukuran, nomorBPB) => {
  const [rows] = await pool.query(
    `SELECT IFNULL(SUM(bpbd_jumlah), 0) AS sudahDiterima 
         FROM retail.tdc_bpb_dtl d
         JOIN retail.tdc_bpb_hdr h ON h.bpb_Nomor = d.bpbd_nomor
         WHERE h.bpb_po_nomor = ? AND d.bpbd_kode = ? AND d.bpbd_ukuran = ? AND d.bpbd_nomor <> ?`,
    [nomorPO, kode, ukuran, nomorBPB || ""]
  );
  return rows[0].sudahDiterima;
};

// Mengambil data dari PO (edtNomorPOExit)
const getDataFromPO = async (nomorPO) => {
  const query = `
        SELECT 
            h.po_nomor, h.po_tanggal, h.po_referensi, h.po_sup_kode,
            d.pod_kode, a.brg_warna, a.brg_bahan, d.pod_ukuran, 
            d.pod_jumlah, d.pod_harga,
            s.Sup_nama, s.Sup_alamat, s.Sup_kota,
            h.po_close
        FROM tdc_po_hdr h
        LEFT JOIN tdc_po_dtl d ON d.pod_nomor = h.po_nomor
        LEFT JOIN retail.tsupplier s ON s.sup_kode = h.po_sup_kode
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.pod_kode
        WHERE h.po_nomor = ?
        ORDER BY d.pod_nourut
    `;
  const [rows] = await pool.query(query, [nomorPO]);
  if (rows.length === 0) throw new Error("PO tersebut tidak ada.");
  if (rows[0].po_close === 1) throw new Error("PO tersebut sudah diclose.");

  const header = {
    nomorPO: rows[0].po_nomor,
    tanggalPO: format(new Date(rows[0].po_tanggal), "yyyy-MM-dd"),
    referensi: rows[0].po_referensi,
    supplierKode: rows[0].po_sup_kode,
    supplierNama: rows[0].Sup_nama,
    alamat: rows[0].Sup_alamat,
    kota: rows[0].Sup_kota,
  };

  const items = await Promise.all(
    rows.map(async (row) => {
      const sudah = await getSudahDiterima(
        row.po_nomor,
        row.pod_kode,
        row.pod_ukuran,
        null
      );
      return {
        kode: row.pod_kode,
        nama: row.brg_warna,
        bahan: row.brg_bahan,
        ukuran: row.pod_ukuran,
        qtyPO: row.pod_jumlah,
        qtyBagus: 0,
        qtyBS: 0,
        jumlah: 0,
        sudah: sudah,
        kurang: row.pod_jumlah - sudah,
        hargaBagus: row.pod_harga,
        hargaBS: 0,
        total: 0,
      };
    })
  );

  return { header, items };
};

// Mengambil data untuk mode Ubah (loaddataall)
const getDataForEdit = async (nomor) => {
  // 1. Ambil data BPB yang ada
  const [bpbRows] = await pool.query(
    `SELECT h.*, d.*, s.Sup_nama, s.Sup_alamat, s.Sup_kota, g.gdg_nama, p.po_tanggal, p.po_referensi
         FROM retail.tdc_bpb_hdr h
         LEFT JOIN retail.tdc_bpb_dtl d ON d.bpbd_nomor = h.bpb_nomor
         LEFT JOIN retail.tsupplier s ON s.sup_kode = h.bpb_sup_kode
         LEFT JOIN retail.tgudang g ON g.gdg_kode = LEFT(h.bpb_nomor, 3)
         LEFT JOIN retail.tdc_po_hdr p ON p.po_nomor = h.bpb_po_nomor
         WHERE h.bpb_nomor = ?`,
    [nomor]
  );
  if (bpbRows.length === 0) throw new Error("Nomor BPB tidak ditemukan.");

  const header = {
    nomor: bpbRows[0].bpb_nomor,
    tanggal: format(new Date(bpbRows[0].bpb_tanggal), "yyyy-MM-dd"),
    nomorPO: bpbRows[0].bpb_po_nomor,
    tanggalPO: format(new Date(bpbRows[0].po_tanggal), "yyyy-MM-dd"),
    referensi: bpbRows[0].po_referensi,
    gudangKode: bpbRows[0].bpb_nomor.substring(0, 3),
    gudangNama: bpbRows[0].gdg_nama,
    keterangan: bpbRows[0].bpb_keterangan,
    supplierKode: bpbRows[0].bpb_sup_kode,
    supplierNama: bpbRows[0].Sup_nama,
    alamat: bpbRows[0].Sup_alamat,
    kota: bpbRows[0].Sup_kota,
  };

  // 2. Ambil data PO asli untuk perbandingan
  const [poRows] = await pool.query(
    `SELECT d.pod_kode, d.pod_ukuran, d.pod_jumlah, a.brg_warna, a.brg_bahan
         FROM tdc_po_dtl d
         LEFT JOIN tbarangdc a ON a.brg_kode = d.pod_kode
         WHERE d.pod_nomor = ?`,
    [header.nomorPO]
  );

  const items = await Promise.all(
    poRows.map(async (po) => {
      const bpbItem = bpbRows.find(
        (b) => b.bpbd_kode === po.pod_kode && b.bpbd_ukuran === po.pod_ukuran
      );
      const sudah = await getSudahDiterima(
        header.nomorPO,
        po.pod_kode,
        po.pod_ukuran,
        nomor
      );

      const qtyBagus = bpbItem ? bpbItem.bpbd_bagus : 0;
      const hargaBagus = bpbItem ? bpbItem.bpbd_hargabagus : 0;
      const qtyBS = bpbItem ? bpbItem.bpbd_bs : 0;
      const hargaBS = bpbItem ? bpbItem.bpbd_hargabs : 0;

      return {
        kode: po.pod_kode,
        nama: po.brg_warna,
        bahan: po.brg_bahan,
        ukuran: po.pod_ukuran,
        qtyPO: po.pod_jumlah,
        qtyBagus: qtyBagus,
        qtyBS: qtyBS,
        jumlah: qtyBagus + qtyBS,
        sudah: sudah,
        kurang: po.pod_jumlah - sudah,
        hargaBagus: hargaBagus,
        hargaBS: hargaBS,
        total: qtyBagus * hargaBagus + qtyBS * hargaBS,
      };
    })
  );

  return { header, items };
};

// Menyimpan data (simpandata)
const saveData = async (data, user) => {
  const { header, items, isEdit } = data;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let bpbNomor = header.nomor;
    if (!isEdit) {
      bpbNomor = await generateNewNumber(
        connection,
        header.tanggal,
        header.gudangKode
      );
    }

    const headerData = {
      bpb_tanggal: header.tanggal,
      bpb_po_nomor: header.nomorPO,
      bpb_sup_kode: header.supplierKode,
      bpb_nominal: header.totalBPB,
      bpb_keterangan: header.keterangan,
    };

    if (isEdit) {
      headerData.user_modified = user.kode;
      headerData.date_modified = new Date();
      await connection.query(
        "UPDATE retail.tdc_bpb_hdr SET ? WHERE bpb_nomor = ?",
        [headerData, bpbNomor]
      );
    } else {
      headerData.bpb_nomor = bpbNomor;
      headerData.user_create = user.kode;
      headerData.date_create = new Date();
      await connection.query(
        "INSERT INTO retail.tdc_bpb_hdr SET ?",
        headerData
      );
    }

    await connection.query(
      "DELETE FROM retail.tdc_bpb_dtl WHERE bpbd_nomor = ?",
      [bpbNomor]
    );

    let totalPO = 0;
    let totalJumlahBPB = 0;
    let totalSudahBPB = 0;

    for (const item of items) {
      if ((item.jumlah || 0) > 0) {
        await connection.query(
          `INSERT INTO retail.tdc_bpb_dtl (bpbd_nomor, bpbd_kode, bpbd_ukuran, bpbd_bagus, bpbd_bs, bpbd_jumlah, bpbd_hargabagus, bpbd_hargabs) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            bpbNomor,
            item.kode,
            item.ukuran,
            item.qtyBagus,
            item.qtyBS,
            item.jumlah,
            item.hargaBagus,
            item.hargaBS,
          ]
        );
      }

      totalPO += item.qtyPO;
      totalJumlahBPB += item.jumlah <= item.qtyPO ? item.jumlah : item.qtyPO;
      totalSudahBPB += item.sudah <= item.qtyPO ? item.sudah : item.qtyPO;
    }

    // Update status PO (logika dari simpandata)
    let newPoStatus = 0; // OPEN
    if (totalJumlahBPB + totalSudahBPB >= totalPO) {
      newPoStatus = 1; // CLOSE
    } else if (
      totalJumlahBPB + totalSudahBPB > 0 &&
      totalJumlahBPB + totalSudahBPB < totalPO
    ) {
      newPoStatus = 2; // ONPROSES
    }
    await connection.query(
      "UPDATE tdc_po_hdr SET po_close = ? WHERE po_nomor = ?",
      [newPoStatus, header.nomorPO]
    );

    await connection.commit();
    return { message: `BPB ${bpbNomor} berhasil disimpan.`, nomor: bpbNomor };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// Mengambil referensi PO
const getPoReferensi = async () => {
  const query = `
        SELECT po_nomor AS nomor, po_tanggal AS tanggal, po_referensi AS referensi, 
               po_ket AS keterangan, sup_nama AS namaSupplier
        FROM retail.tdc_po_hdr
        INNER JOIN retail.tsupplier ON po_sup_kode = sup_kode 
        WHERE po_close <> 1
        ORDER BY tdc_po_hdr.date_create DESC
    `;
  const [rows] = await pool.query(query);
  return rows;
};

// --- FUNGSI TERBILANG ---
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
        terbilangRecursive(n % 1000000)
      );
    if (num < 1000000000000)
      return (
        terbilangRecursive(Math.floor(num / 1000000000)) +
        " miliar " +
        terbilangRecursive(n % 1000000000)
      );
    return "angka terlalu besar";
  };
  let hasil = terbilangRecursive(n).replace(/\s+/g, " ").trim();
  return hasil.charAt(0).toUpperCase() + hasil.slice(1);
}
// ------------------------------------

/**
 * Mengambil data untuk cetak BPB Kaosan.
 * Menerjemahkan TfrmBPBkaosan.cetak
 */
const getPrintData = async (nomor) => {
  const query = `
        SELECT 
            h.bpb_nomor, h.bpb_tanggal, h.bpb_keterangan, h.bpb_nominal, h.user_create,
            DATE_FORMAT(h.date_create, "%d-%m-%Y %T") AS created,
            p.po_nomor, DATE_FORMAT(p.po_tanggal, "%d-%m-%Y") AS dtpo,
            s.sup_nama, s.sup_alamat, s.sup_kota,
            g.gdg_nama,
            d.bpbd_kode, d.bpbd_ukuran, d.bpbd_bagus, d.bpbd_bs, d.bpbd_jumlah,
            a.brg_warna AS nama, a.brg_bahan AS bahan,
            'CV. Kencana Print' AS perush_nama, tp.perush_alamat, tp.perush_kota, tp.perush_telp
        FROM retail.tdc_bpb_hdr h
        LEFT JOIN retail.tdc_bpb_dtl d ON d.bpbd_nomor = h.bpb_nomor
        LEFT JOIN retail.tdc_po_hdr p ON p.po_nomor = h.bpb_po_nomor
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.bpbd_kode
        LEFT JOIN retail.tsupplier s ON s.sup_kode = h.bpb_sup_kode
        LEFT JOIN retail.tgudang g ON g.gdg_kode = LEFT(h.bpb_nomor, 3)
        CROSS JOIN retail.tperusahaan tp
        WHERE h.bpb_nomor = ? AND tp.perush_kode = "KS";
    `;

  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) throw new Error("Data cetak tidak ditemukan.");

  const header = { ...rows[0] };
  const details = rows
    .filter((row) => row.bpbd_kode) // Hanya ambil baris yang punya data detail
    .map((row) => ({
      bpbd_kode: row.bpbd_kode,
      nama: row.nama,
      bahan: row.bahan,
      bpbd_ukuran: row.bpbd_ukuran,
      bpbd_bagus: row.bpbd_bagus,
      bpbd_bs: row.bpbd_bs,
      bpbd_jumlah: row.bpbd_jumlah,
    }));

  const totalQty = details.reduce(
    (sum, item) => sum + (item.bpbd_jumlah || 0),
    0
  );
  header.totalQty = totalQty;
  header.terbilang = terbilang(header.bpb_nominal || 0);

  return { header, details };
};

module.exports = {
  getDataFromPO,
  getDataForEdit,
  saveData,
  getPoReferensi,
  getPrintData,
};
