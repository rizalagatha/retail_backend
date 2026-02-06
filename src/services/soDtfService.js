const pool = require("../config/database");
const { format } = require("date-fns");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const getSoDtfList = async (filters, user) => {
  const { startDate, endDate, cabang, filterDateType, status } = filters;
  const userCabang = user?.cabang || "";
  let params = [startDate, endDate];

  const dateColumn =
    filterDateType === "pengerjaan" ? "h.sd_datekerja" : "h.sd_tanggal";

  // --- LOGIKA FILTER KHUSUS K06 (Kecualikan K06 sendiri) ---
  let branchQuery = "";

  if (userCabang === "K06") {
    if (cabang === "ALL") {
      // Tampilkan kiriman dari SEMUA cabang lain ke workshop K06
      // Kecualikan yang dibuat oleh K06 sendiri (h.sd_cab <> 'K06')
      branchQuery = "AND h.sd_Workshop = 'K06' AND h.sd_cab <> 'K06'";
    } else {
      // Tampilkan kiriman dari cabang spesifik yang dipilih ke workshop K06
      // (K06 tidak akan muncul karena pilihan 'cabang' di dropdown pasti cabang lain)
      branchQuery = "AND h.sd_cab = ? AND h.sd_Workshop = 'K06'";
      params.push(cabang);
    }
  } else if (userCabang === "KDC") {
    // Admin Pusat tetap bisa lihat sesuai pilihan dropdown
    if (cabang !== "ALL") {
      branchQuery = "AND h.sd_cab = ?";
      params.push(cabang);
    }
  } else {
    // Cabang standar hanya lihat miliknya sendiri
    branchQuery = "AND h.sd_cab = ?";
    params.push(userCabang);
  }

  const query = `
        SELECT 
            x.Nomor, 
            x.Tanggal, 
            x.TglPengerjaan, 
            x.DatelineCus, 
            x.NamaDTF, 
            x.Jumlah, 
            x.Titik, 
            -- [FIX] Gunakan Nama Kolom yang Sesuai (Case Sensitive)
            (x.Jumlah * x.Titik) AS TotalTitik, 
            -- [FIX] Pastikan LHK yang null menjadi 0
            IFNULL(x.LHK_Raw, 0) AS LHK,
            x.NoSO, x.NoINV, x.Sales, x.BagDesain, x.KdCus, x.Customer, x.Kain, 
            x.Finishing, x.Workshop, x.Keterangan, x.AlasanClose, x.Created, x.Close
        FROM (
            SELECT 
                h.sd_nomor AS Nomor, 
                DATE_FORMAT(h.sd_tanggal, '%d-%m-%Y') AS Tanggal, 
                DATE_FORMAT(h.sd_datekerja, '%d-%m-%Y') AS TglPengerjaan, 
                h.sd_dateline AS DatelineCus, h.sd_nama AS NamaDTF,
                IFNULL((SELECT SUM(i.sdd_jumlah) FROM tsodtf_dtl i WHERE i.sdd_nomor = h.sd_nomor), 0) AS Jumlah,
                IFNULL((SELECT COUNT(*) FROM tsodtf_dtl2 i WHERE i.sdd2_nomor = h.sd_nomor), 0) AS Titik,
                -- [FIX] Beri alias berbeda agar bisa di-IFNULL di luar
                (SELECT SUM(f.depan + f.belakang + f.lengan + f.variasi + f.saku) FROM tdtf f WHERE f.sodtf = h.sd_nomor) AS LHK_Raw,
                IFNULL((SELECT dd.sod_so_nomor FROM tso_dtl dd WHERE dd.sod_sd_nomor = h.sd_nomor GROUP BY dd.sod_so_nomor LIMIT 1), "") AS NoSO,
                IFNULL((SELECT dd.invd_inv_nomor FROM tinv_dtl dd WHERE dd.invd_sd_nomor = h.sd_nomor GROUP BY dd.invd_inv_nomor LIMIT 1), "") AS NoINV,
                s.sal_nama AS Sales, h.sd_desain AS BagDesain, h.sd_Workshop AS Workshop,
                h.sd_cus_kode AS KdCus, c.cus_nama AS Customer, h.sd_kain AS Kain, h.sd_finishing AS Finishing,
                h.sd_ket AS Keterangan, h.sd_alasan AS AlasanClose,
                h.user_create AS Created, h.user_modified AS UserModified,
                h.date_modified AS DateModified, h.sd_closing AS Close,
                h.sd_cab
            FROM tsodtf_hdr h
            LEFT JOIN tcustomer c ON c.cus_kode = h.sd_cus_kode
            LEFT JOIN kencanaprint.tsales s ON s.sal_kode = h.sd_sal_kode
            WHERE h.sd_stok = "" AND ${dateColumn} BETWEEN ? AND ?
            ${branchQuery} 
        ) x
        ${status === "belum_invoice" ? " WHERE x.NoINV = '' AND x.Close <> 'Y'" : ""}
        ORDER BY x.Tanggal, x.Nomor;
    `;

  const [rows] = await pool.query(query, params);
  return rows;
};

const getSoDtfDetails = async (nomor) => {
  const query = `
    SELECT 
      sdd_nama_barang AS NamaBarang,
      sdd_ukuran AS Ukuran, 
      sdd_jumlah AS Jumlah 
    FROM tsodtf_dtl 
    WHERE sdd_nomor = ? 
    ORDER BY sdd_nourut
  `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

const closeSoDtf = async (nomor, alasan, user) => {
  const query = `UPDATE tsodtf_hdr SET sd_alasan = ?, sd_closing = 'Y', user_modified = ?, date_modified = NOW() WHERE sd_nomor = ?`;
  const [result] = await pool.query(query, [alasan, user, nomor]);
  if (result.affectedRows === 0) {
    throw new Error("Gagal menutup SO DTF, nomor tidak ditemukan.");
  }
  return { message: "SO DTF berhasil ditutup." };
};

/**
 * @description Menghapus data SO DTF setelah validasi.
 * @param {string} nomor - Nomor SO DTF yang akan dihapus.
 * @param {object} user - Objek user yang sedang login.
 */
const remove = async (nomor, user) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    // 1. Ambil data yang akan divalidasi menggunakan query langsung (tanpa view)
    const validationQuery = `
            SELECT 
                h.sd_nomor,
                h.sd_closing AS Close,
                IFNULL((SELECT dd.sod_so_nomor FROM tso_dtl dd WHERE dd.sod_sd_nomor = h.sd_nomor GROUP BY dd.sod_so_nomor LIMIT 1), "") AS NoSO,
                IFNULL((SELECT dd.invd_inv_nomor FROM tinv_dtl dd WHERE dd.invd_sd_nomor = h.sd_nomor GROUP BY dd.invd_inv_nomor LIMIT 1), "") AS NoINV
            FROM tsodtf_hdr h
            WHERE h.sd_nomor = ?
        `;
    const [rows] = await connection.query(validationQuery, [nomor]);

    if (rows.length === 0) {
      throw new Error("Data tidak ditemukan.");
    }
    const record = rows[0];

    // 2. Lakukan semua validasi seperti di Delphi
    if (
      user.cabang !== "KDC" &&
      user.cabang !== record.sd_nomor.substring(0, 3)
    ) {
      throw new Error(
        `Anda tidak berhak menghapus data milik cabang ${record.sd_nomor.substring(
          0,
          3,
        )}.`,
      );
    }
    if (record.NoSO) {
      throw new Error("Sudah dibuat SO, tidak bisa dihapus.");
    }
    if (record.NoINV) {
      throw new Error("Sudah dibuat Invoice, tidak bisa dihapus.");
    }
    if (record.Close === "Y") {
      throw new Error("Transaksi sudah ditutup, tidak bisa dihapus.");
    }

    // 3. Hapus data dari tabel header
    // PENTING: Diasumsikan foreign key di tsodtf_dtl & tsodtf_dtl2 sudah di-set ON DELETE CASCADE
    await connection.query("DELETE FROM tsodtf_hdr WHERE sd_nomor = ?", [
      nomor,
    ]);

    await connection.commit();

    // 4. Hapus file gambar setelah transaksi DB berhasil
    const cabang = nomor.substring(0, 3);
    const imagePath = path.join(
      process.cwd(),
      "public",
      "images",
      "sodtf",
      cabang,
      `${nomor}.jpg`,
    );
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    return { message: `SO DTF ${nomor} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw new Error(error.message || "Gagal menghapus data.");
  } finally {
    connection.release();
  }
};

const exportHeader = async (filters, user) => {
  // Teruskan 'user' ke getSoDtfList agar pengecekan cabang K06 jalan
  return await getSoDtfList(filters, user);
};

const exportDetail = async (filters) => {
  const { startDate, endDate, cabang, filterDateType } = filters;
  const dateColumn =
    filterDateType === "pengerjaan" ? "h.sd_datekerja" : "h.sd_tanggal";
  let params = [startDate, endDate];

  // Query ini kembali menggunakan filter tanggal dan cabang
  let query = `
        SELECT 
            h.sd_nomor AS Nomor, 
            DATE_FORMAT(h.sd_tanggal, '%d-%m-%Y') AS Tanggal, 
            DATE_FORMAT(h.sd_datekerja, '%d-%m-%Y') AS TglPengerjaan, 
            h.sd_nama AS NamaDTF,
            (SELECT SUM(i.sdd_jumlah) FROM tsodtf_dtl i WHERE i.sdd_nomor = h.sd_nomor) AS JmlHeader,
            (SELECT COUNT(*) FROM tsodtf_dtl2 i WHERE i.sdd2_nomor = h.sd_nomor) AS Titik,
            IFNULL((SELECT dd.sod_so_nomor FROM tso_dtl dd WHERE dd.sod_sd_nomor = h.sd_nomor GROUP BY dd.sod_so_nomor LIMIT 1), "") AS NoSO,
            s.sal_nama AS Sales, 
            c.cus_nama AS Customer,
            d.sdd_ukuran AS Ukuran, 
            d.sdd_jumlah AS Jumlah
        FROM tsodtf_hdr h
        JOIN tsodtf_dtl d ON h.sd_nomor = d.sdd_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = h.sd_cus_kode
        LEFT JOIN kencanaprint.tsales s ON s.sal_kode = h.sd_sal_kode
        WHERE ${dateColumn} BETWEEN ? AND ?
    `;

  if (cabang !== "ALL") {
    query += " AND h.sd_cab = ?";
    params.push(cabang);
  }
  query += " ORDER BY h.sd_nomor, d.sdd_nourut";

  const [data] = await pool.query(query, params);
  return data;
};

module.exports = {
  getSoDtfList,
  getSoDtfDetails,
  closeSoDtf,
  remove,
  exportHeader,
  exportDetail,
};
