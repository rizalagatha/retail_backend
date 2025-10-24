const pool = require("../config/database");
const { format, parseISO } = require("date-fns");
const fs = require("fs");
const path = require("path");
const uploadDir = path.join(__dirname, "../../public/images/cabang/KDC/PO");

// Helper: getmaxnomor
const generateNewNumber = async (connection, date) => {
  const ayy = format(new Date(date), "yy");
  const prefix = `PO${ayy}`;
  const [rows] = await connection.query(
    "SELECT IFNULL(MAX(RIGHT(po_nomor, 5)), 0) as max_nomor FROM tdc_po_hdr WHERE LEFT(po_nomor, 4) = ?",
    [prefix]
  );
  const nextNum = parseInt(rows[0].max_nomor, 10) + 1;
  return `${prefix}${String(100000 + nextNum).slice(-5)}`;
};

// --- FUNGSI BARU ---
// Mengambil referensi Pengajuan Produksi (TfrmPOKaosan.FormKeyDown F1 on edtreferensi)
const getReferensiPengajuan = async () => {
  const query = `
        SELECT 
            h.pp_nomor AS nomor,
            h.pp_tanggal AS tanggal,
            h.pp_sup_kode AS kodeSupplier,
            s.Sup_nama AS namaSupplier,
            CONCAT(s.Sup_alamat, ' ', s.Sup_kota) AS alamat,
            h.pp_ket AS keterangan
        FROM retail.tdc_pengajuanproduksi_hdr h
        INNER JOIN retail.tsupplier s ON s.sup_kode = h.pp_sup_kode
        WHERE h.pp_approved <> "" 
          AND h.pp_nomor NOT IN (SELECT po_referensi FROM retail.tdc_po_hdr WHERE po_referensi IS NOT NULL AND po_referensi <> '')
        ORDER BY h.date_create DESC
    `;
  const [rows] = await pool.query(query);
  return rows;
};

// --- FUNGSI BARU ---
// Mengambil detail supplier (TfrmPOKaosan.edtSupKodeExit)
const getSupplierDetails = async (kode) => {
  const [rows] = await pool.query(
    'SELECT sup_nama, sup_alamat, sup_kota FROM retail.tsupplier WHERE sup_aktif="Y" AND sup_kode = ?',
    [kode]
  );
  if (rows.length === 0)
    throw new Error("Kode supplier tidak ditemukan atau tidak aktif.");
  return rows[0];
};

// Mengambil data dari Pengajuan Produksi (edtreferensiExit)
const getDataFromPengajuan = async (nomor) => {
  const query = `
        SELECT 
            h.pp_nomor, h.pp_sup_kode, h.pp_ket,
            s.Sup_nama, s.Sup_alamat, s.Sup_kota,
            IFNULL((SELECT j.po_nomor FROM tdc_po_hdr j WHERE j.po_referensi = h.pp_nomor LIMIT 1), "") AS noPO,
            d.ppd_nourut, d.ppd_nama, d.ppd_bahan, d.ppd_ukuran, d.ppd_jumlah, d.ppd_harga,
            (d.ppd_jumlah * d.ppd_harga) AS total,
            d.ppd_gambar AS gambar
        FROM tdc_pengajuanproduksi_hdr h
        LEFT JOIN retail.tdc_pengajuanproduksi_dtl d ON d.ppd_nomor = h.pp_nomor
        INNER JOIN retail.tsupplier s ON s.sup_kode = h.pp_sup_kode
        WHERE h.pp_nomor = ? AND d.ppd_approved = "Y" AND h.pp_approved <> ""
    `;
  const [rows] = await pool.query(query, [nomor]);

  if (rows.length === 0)
    throw new Error(
      "No. Referensi tidak ditemukan atau item belum di-approve."
    );
  if (rows[0].noPO)
    throw new Error(
      `No. Referensi ini sudah dipakai di PO nomor: ${rows[0].noPO}.`
    );

  const header = {
    pp_sup_kode: rows[0].pp_sup_kode,
    pp_ket: rows[0].pp_ket,
    Sup_nama: rows[0].Sup_nama,
    Sup_alamat: rows[0].Sup_alamat,
    Sup_kota: rows[0].Sup_kota,
  };
  const items = rows.map((row) => ({
    kode: "",
    nama: row.ppd_nama,
    bahan: row.ppd_bahan,
    ukuran: row.ppd_ukuran,
    jumlah: row.ppd_jumlah,
    harga: row.ppd_harga,
    diskon: 0,
    total: row.total,
    ket: "",
    gambar: row.gambar,
  }));

  return { header, items };
};

// Mengambil data untuk mode Ubah (loaddataall)
const getDataForEdit = async (nomor) => {
  const [poRows] = await pool.query(
    "SELECT * FROM tdc_bpb_hdr WHERE bpb_po_nomor = ?",
    [nomor]
  );
  const lblbpb = poRows.length > 0; // Cek apakah sudah ada BPB

  const query = `
        SELECT 
            h.*,
            d.pod_kode AS kode, d.pod_ukuran AS ukuran, d.pod_jumlah AS jumlah, 
            d.pod_harga AS harga, d.pod_disc AS diskon, d.pod_ket AS ket, d.pod_gambar AS gambar,
            a.brg_warna AS nama, a.brg_bahan AS bahan,
            s.Sup_nama, s.Sup_alamat, s.Sup_kota
        FROM tdc_po_hdr h
        LEFT JOIN tdc_po_dtl d ON d.pod_nomor = h.po_nomor
        LEFT JOIN retail.tsupplier s ON s.sup_kode = h.po_sup_kode
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.pod_kode
        WHERE h.po_nomor = ?
        ORDER BY d.pod_nourut
    `;
  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) throw new Error("Nomor PO tidak ditemukan.");

  const header = {
    ...rows[0],
    po_tanggal: format(new Date(rows[0].po_tanggal), "yyyy-MM-dd"),
    po_status_ppn: rows[0].po_status_ppn === 1,
    lblbpb: lblbpb, // Kirim status BPB ke frontend
  };
  const items = rows
    .map((row) => ({
      ...row,
      id: Math.random(),
      total:
        (row.jumlah || 0) *
        (row.harga || 0) *
        ((100 - (row.diskon || 0)) / 100),
    }))
    .filter((item) => item.nama); // Filter item yang valid

  return { header, items };
};

// Menyimpan data (simpandata)
const saveData = async (data, user) => {
  const { header, items, isEdit } = data;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let poNomor = header.po_nomor;
    if (!isEdit) {
      poNomor = await generateNewNumber(connection, header.po_tanggal);
    }

    const headerData = {
      po_tanggal: header.po_tanggal,
      po_ket: header.po_ket,
      po_note: header.po_note,
      po_sup_kode: header.po_sup_kode,
      po_referensi: header.po_referensi,
      po_status_ppn: header.po_status_ppn ? 1 : 0,
      po_ppn: header.po_ppn || 0,
      po_nominal: header.po_nominal || 0,
    };

    if (isEdit) {
      headerData.user_modified = user.kode;
      headerData.date_modified = new Date();
      await connection.query("UPDATE tdc_po_hdr SET ? WHERE po_nomor = ?", [
        headerData,
        poNomor,
      ]);
    } else {
      headerData.po_nomor = poNomor;
      headerData.user_create = user.kode;
      headerData.date_create = new Date();
      await connection.query("INSERT INTO tdc_po_hdr SET ?", headerData);
    }

    await connection.query("DELETE FROM tdc_po_dtl WHERE pod_nomor = ?", [
      poNomor,
    ]);

    const poUploadDir = path.join(uploadDir, poNomor);
    if (files.length > 0 && !fs.existsSync(poUploadDir)) {
      fs.mkdirSync(poUploadDir, { recursive: true });
    }

    for (const [index, item] of items.entries()) {
      if (item.nama && (item.jumlah || 0) > 0) {
        let fileGambarFlag = item.gambar || ""; // 'Y' atau nama file lama
        const file = files.find((f) => f.fieldname === `file_${index}`);

        if (file) {
          // Pindahkan file baru
          const fileName = `${poNomor}_${item.kode}_${item.ukuran}.jpg`;
          const newPath = path.join(poUploadDir, fileName);
          fs.renameSync(file.path, newPath);
          fileGambarFlag = fileName; // Simpan nama file
        } else if (!fileGambarFlag && isEdit) {
          // Hapus file lama jika user menghapusnya
          // (Perlu logika untuk menghapus file lama jika ada)
        }

        await connection.query(
          `INSERT INTO tdc_po_dtl (pod_nomor, pod_kode, pod_ukuran, pod_jumlah, pod_disc, pod_harga, pod_ket, pod_gambar, pod_nourut) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            poNomor,
            item.kode || "",
            item.ukuran || "",
            item.jumlah,
            item.diskon || 0,
            item.harga || 0,
            item.ket || "",
            fileGambarFlag,
            index + 1,
          ]
        );
      }
    }

    await connection.commit();
    return { message: `PO ${poNomor} berhasil disimpan.`, nomor: poNomor };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Mengubah angka menjadi format teks Rupiah.
 */
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
    // Perbaikan kecil untuk angka lebih besar
    if (num < 1000000000000)
      return (
        terbilangRecursive(Math.floor(num / 1000000000)) +
        " miliar " +
        terbilangRecursive(n % 1000000000)
      );
    return "angka terlalu besar";
  };

  let hasil = terbilangRecursive(n).replace(/\s+/g, " ").trim();
  return hasil.charAt(0).toUpperCase() + hasil.slice(1); // Kapitalisasi huruf pertama
}
// ------------------------------------

/**
 * Mengambil data untuk cetak PO Kaosan.
 * Menerjemahkan logika agregasi dari TfrmPOKaosan.cetak
 */
const getPrintData = async (nomor) => {
  const query = `
        SELECT
            h.po_nomor, h.po_tanggal, h.po_ket, h.po_note, h.po_nominal, h.user_create,
            h.po_referensi, 
            
            s.sup_nama, s.sup_kode, 
            CONCAT(s.sup_alamat COLLATE latin1_swedish_ci, ' ', s.sup_kota COLLATE latin1_swedish_ci) as alamat, 
            s.sup_telp, s.sup_cp,
            
            'CV. Kencana Print' AS perush_nama,
            p.perush_alamat, p.perush_kota, p.perush_telp, p.perush_fax, p.perush_namapemilik,
            DATE_FORMAT(h.date_create, "%d-%m-%Y %T") as created,
            
            d.pod_kode AS kode,
            d.pod_ket AS ket,
            d.pod_gambar AS gambar,
            -- Gabungkan nama barang dari tbarangdc
            TRIM(CONCAT(a.brg_warna, " ", a.brg_bahan)) AS nama,
            
            -- Agregasi detail barang
            GROUP_CONCAT(
                CONCAT(
                    CONVERT(COALESCE(d.pod_ukuran, '') USING utf8mb4),
                    '=',
                    FORMAT(COALESCE(d.pod_jumlah, 0), 0, 'id_ID'),
                    ' x ',
                    FORMAT(COALESCE(d.pod_harga, 0), 0, 'id_ID')
                )
                SEPARATOR '\n'
            ) AS ukuran_qty_harga,
            
            SUM(d.pod_jumlah * d.pod_harga * ((100 - d.pod_disc) / 100)) AS total_harga,
            SUM(d.pod_jumlah) as total_qty

        FROM tdc_po_hdr h
        LEFT JOIN tdc_po_dtl d ON d.pod_nomor = h.po_nomor
        LEFT JOIN retail.tsupplier s ON s.sup_kode = h.po_sup_kode
        LEFT JOIN retail.tbarangdc a ON a.brg_kode = d.pod_kode
        CROSS JOIN retail.tperusahaan p
        WHERE TRIM(h.po_nomor) = ? AND p.perush_kode = "KS"
        
        -- --- PERBAIKAN DI SINI ---
        -- GROUP BY berdasarkan kolom yang ada di tbarangdc (a) bukan tdc_po_dtl (d)
        GROUP BY h.po_nomor, d.pod_kode, a.brg_warna, a.brg_bahan, d.pod_ket, d.pod_gambar
        -- -------------------------
        
        ORDER BY d.pod_nourut;
    `;

  try {
    const [rows] = await pool.query(query, [nomor.trim()]);
    if (rows.length === 0) {
      throw new Error("Data cetak tidak ditemukan.");
    }

    const header = { ...rows[0] };
    // ... (hapus properti detail dari header)
    delete header.nama;
    delete header.ket;
    delete header.gambar;
    delete header.ukuran_qty_harga;
    delete header.total_harga;
    delete header.total_qty;

    const details = rows
      .filter((row) => row.nama)
      .map((row) => ({
        nama: row.nama,
        ket: row.ket,
        ukuran_qty_harga: row.ukuran_qty_harga,
        total_harga: row.total_harga,
        gambar: row.gambar,
      }));

    const grandTotal = header.po_nominal || 0;
    const totalQty = rows.reduce(
      (sum, item) => sum + (Number(item.total_qty) || 0),
      0
    );

    header.gtotal = grandTotal;
    header.tq = totalQty;
    header.bilang = terbilang(grandTotal);

    return { header, details };
  } catch (err) {
    console.error("SQL ERROR:", err.sqlMessage || err.message);
    throw err;
  }
};

// Mengambil data barang tunggal berdasarkan barcode (mirip TfrmMtsAg.loadbrg)
const getProductByBarcode = async (barcode) => {
  // Query ini tidak mengambil stok, hanya info barang
  const query = `
        SELECT 
            b.brgd_kode AS kode, 
            b.brgd_barcode AS barcode,
            TRIM(CONCAT(a.brg_warna)) AS nama,
            a.brg_bahan AS bahan,
            b.brgd_ukuran AS ukuran,
            b.brgd_harga AS harga
        FROM retail.tbarangdc_dtl b
        INNER JOIN retail.tbarangdc a ON a.brg_kode = b.brgd_kode
        WHERE a.brg_aktif = 0 AND a.brg_logstok = "Y" 
          AND a.brg_ktg <> ""
          AND b.brgd_barcode = ?
    `;
  const [rows] = await pool.query(query, [barcode]);
  if (rows.length === 0)
    throw new Error("Barcode tidak terdaftar atau barang tidak aktif.");

  return rows[0];
};

module.exports = {
  getReferensiPengajuan,
  getSupplierDetails,
  getDataFromPengajuan,
  getDataForEdit,
  saveData,
  getPrintData,
  getProductByBarcode,
};
