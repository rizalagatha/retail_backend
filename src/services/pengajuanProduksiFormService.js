const pool = require("../config/database");
const { format } = require("date-fns");
const fs = require("fs");
const path = require("path");

// Tentukan path upload Anda
const uploadDir = path.join(__dirname, "../../public/images/cabang");

// Fungsi helper untuk membuat nomor PP baru
const generateNewNumber = async (connection, date, cabang) => {
  const prefix = `PP${format(new Date(date), "yy")}`;
  const query = `SELECT IFNULL(MAX(RIGHT(pp_nomor, 5)), 0) as max_nomor FROM retail.tdc_pengajuanproduksi_hdr WHERE LEFT(pp_nomor, 4) = ?`;
  const [rows] = await connection.query(query, [prefix]);
  const nextNumber = parseInt(rows[0].max_nomor, 10) + 1;
  return `${prefix}${String(nextNumber).padStart(5, "0")}`;
};

// Mengambil detail supplier (dari edtkdsupExit)
const getSupplierDetails = async (kode) => {
  const [rows] = await pool.query(
    "SELECT sup_nama, sup_alamat, sup_kota, sup_telp, sup_aktif FROM tsupplier WHERE sup_kode = ?",
    [kode]
  );
  if (rows.length === 0) throw new Error("Supplier tidak ada di database.");
  if (rows[0].sup_aktif === "N") throw new Error("Supplier tsb tidak aktif.");
  return rows[0];
};

// Mengambil data untuk mode Ubah (dari loaddataall)
const getDataForEdit = async (nomor) => {
  const query = `
        SELECT h.*, d.*, s.Sup_nama, CONCAT(s.Sup_alamat," ",s.Sup_kota) as alamat, s.sup_telp
        FROM retail.tdc_pengajuanproduksi_hdr h
        LEFT JOIN retail.tdc_pengajuanproduksi_dtl d ON d.ppd_nomor = h.pp_nomor
        LEFT JOIN retail.tsupplier s ON s.sup_kode = h.pp_sup_kode
        WHERE h.pp_nomor = ?
        ORDER BY d.ppd_nourut
    `;
  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) throw new Error("Nomor tidak ditemukan.");

  const header = {
    nomor: rows[0].pp_nomor,
    tanggal: format(new Date(rows[0].pp_tanggal), "yyyy-MM-dd"),
    cabang: rows[0].pp_cab,
    keterangan: rows[0].pp_ket,
    supplierKode: rows[0].pp_sup_kode,
    supplierNama: rows[0].Sup_nama,
    alamat: rows[0].alamat,
    telepon: rows[0].sup_telp,
  };

  const items = rows.map((row) => ({
    nama: row.ppd_nama,
    bahan: row.ppd_bahan,
    ukuran: row.ppd_ukuran,
    jumlah: row.ppd_jumlah,
    harga: row.ppd_harga,
    total: row.ppd_jumlah * row.ppd_harga,
    filegambar: row.ppd_gambar || "", // 'Y' atau ''
  }));

  return { header, items };
};

// Menyimpan data (dari simpandata)
const saveData = async (data, files, user) => {
  const { header, items } = data;
  const isEdit = !!header.nomor && header.nomor !== "<--Kosong=Baru";
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let ppNomor = header.nomor;
    if (!isEdit) {
      ppNomor = await generateNewNumber(
        connection,
        header.tanggal,
        header.cabang
      );
    }

    if (isEdit) {
      await connection.query(
        "UPDATE retail.tdc_pengajuanproduksi_hdr SET pp_tanggal = ?, pp_sup_kode = ?, pp_ket = ?, user_modified = ?, date_modified = NOW() WHERE pp_nomor = ?",
        [
          header.tanggal,
          header.supplierKode,
          header.keterangan,
          user.kode,
          ppNomor,
        ]
      );
    } else {
      await connection.query(
        "INSERT INTO retail.tdc_pengajuanproduksi_hdr (pp_nomor, pp_tanggal, pp_sup_kode, pp_ket, pp_cab, user_create, date_create) VALUES (?, ?, ?, ?, ?, ?, NOW())",
        [
          ppNomor,
          header.tanggal,
          header.supplierKode,
          header.keterangan,
          header.cabang,
          user.kode,
        ]
      );
    }

    // Hapus detail lama
    await connection.query(
      "DELETE FROM retail.tdc_pengajuanproduksi_dtl WHERE ppd_nomor = ?",
      [ppNomor]
    );

    // Buat folder cabang jika belum ada
    const branchUploadDir = path.join(uploadDir, header.cabang);
    if (!fs.existsSync(branchUploadDir)) {
      fs.mkdirSync(branchUploadDir, { recursive: true });
    }

    // Insert detail baru
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.nama || (item.jumlah || 0) === 0) continue;

      let fileGambarFlag = item.filegambar || ""; // 'Y' jika file lama dipertahankan
      const file = files.find((f) => f.fieldname === `file_${i}`);
      const fileName = `${ppNomor}${item.nama}${item.ukuran}.jpg`;
      const newPath = path.join(branchUploadDir, fileName);

      if (file) {
        // Pindahkan file baru
        fs.renameSync(file.path, newPath);
        fileGambarFlag = "Y";
      } else if (!fileGambarFlag && isEdit) {
        // Hapus file lama jika user menghapusnya
        if (fs.existsSync(newPath)) {
          fs.unlinkSync(newPath);
        }
      }

      await connection.query(
        "INSERT INTO retail.tdc_pengajuanproduksi_dtl (ppd_nomor, ppd_nama, ppd_bahan, ppd_ukuran, ppd_jumlah, ppd_harga, ppd_nourut, ppd_gambar) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          ppNomor,
          item.nama,
          item.bahan,
          item.ukuran,
          item.jumlah,
          item.harga,
          i + 1,
          fileGambarFlag,
        ]
      );
    }

    await connection.commit();
    return {
      message: `Pengajuan ${ppNomor} berhasil disimpan.`,
      nomor: ppNomor,
    };
  } catch (error) {
    await connection.rollback();
    // Hapus file yang sudah terupload jika transaksi gagal
    files.forEach((file) => fs.unlinkSync(file.path));
    throw error;
  } finally {
    connection.release();
  }
};

const validateUkuran = async (ukuran) => {
  const query = "SELECT 1 FROM tukuran WHERE ukuran = ? LIMIT 1";
  const [rows] = await pool.query(query, [ukuran]);
  if (rows.length === 0) {
    throw new Error("Ukuran tersebut belum terdaftar.");
  }
  return { isValid: true };
};

/**
 * Mengambil data untuk cetak Pengajuan Produksi.
 * Menerjemahkan logika agregasi dari TfrmPengajuanProduksi.cetak
 */
const getPrintData = async (nomor) => {
  const query = `
    SELECT
        h.pp_nomor,
        h.pp_tanggal,
        h.pp_ket,
        h.user_create,
        s.sup_nama,
        s.sup_kode,

        -- Ubah semua kolom latin1 jadi utf8mb4 dengan CONVERT
        CONCAT(
            CONVERT(s.sup_alamat USING utf8mb4),
            ' ',
            CONVERT(s.sup_kota USING utf8mb4)
        ) AS alamat,

        s.sup_telp,
        'CV. Kencana Print' AS perush_nama,
        p.perush_alamat,
        p.perush_kota,
        p.perush_telp,
        p.perush_fax,
        DATE_FORMAT(h.date_create, '%d-%m-%Y %T') AS created,

        COALESCE(d.ppd_nama, '') AS nama,
        COALESCE(d.ppd_bahan, '') AS bahan,

        GROUP_CONCAT(
            CONCAT(
                CONVERT(COALESCE(d.ppd_ukuran, '') USING utf8mb4),
                '=',
                FORMAT(COALESCE(d.ppd_jumlah, 0), 0),
                ' x ',
                FORMAT(COALESCE(d.ppd_harga, 0), 0)
            )
            SEPARATOR '\\n'
        ) AS ukuran_qty_harga,

        SUM(COALESCE(d.ppd_jumlah, 0) * COALESCE(d.ppd_harga, 0)) AS total_harga

    FROM retail.tdc_pengajuanproduksi_hdr h
    LEFT JOIN retail.tdc_pengajuanproduksi_dtl d ON d.ppd_nomor = h.pp_nomor
    LEFT JOIN retail.tsupplier s ON s.sup_kode = h.pp_sup_kode
    CROSS JOIN tperusahaan p
    WHERE TRIM(h.pp_nomor) = ?
    GROUP BY h.pp_nomor, d.ppd_nama, d.ppd_bahan
    ORDER BY d.ppd_nourut;
  `;

  try {
    const [rows] = await pool.query(query, [nomor.trim()]);
    console.log('Jumlah baris hasil:', rows.length);
    if (rows.length === 0) {
      throw new Error('Data cetak tidak ditemukan.');
    }

    const header = { ...rows[0] };
    delete header.nama;
    delete header.bahan;
    delete header.ukuran_qty_harga;
    delete header.total_harga;

    const details = rows.map((row) => ({
      nama: row.nama,
      bahan: row.bahan,
      ukuran_qty_harga: row.ukuran_qty_harga,
      total_harga: row.total_harga,
    }));

    const grandTotal = details.reduce(
      (sum, item) => sum + (item.total_harga || 0),
      0
    );
    header.grandTotal = grandTotal;

    return { header, details };
  } catch (err) {
    console.error('SQL ERROR:', err.sqlMessage || err.message);
    throw err;
  }
};

module.exports = {
  getSupplierDetails,
  getDataForEdit,
  saveData,
  validateUkuran,
  getPrintData,
};
