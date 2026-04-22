const pool = require("../config/database");
const { format } = require("date-fns");
const fs = require("fs");
const path = require("path");

const getSoDtfList = async (filters, user) => {
  const { startDate, endDate, cabang, status } = filters;

  // Ambil cabang dari token, kalau gak ada ambil dari dropdown frontend
  const activeBranch = user?.cabang || (cabang !== "ALL" ? cabang : "");

  let params = [startDate, endDate];
  let branchQuery = "";

  // Logika Filter Sederhana & Pasti
  if (user?.cabang === "K06") {
    if (cabang === "ALL") {
      branchQuery = "AND h.sd_workshop = 'K06' AND h.sd_cab <> 'K06'";
    } else if (cabang === "K06") {
      branchQuery = "AND h.sd_cab = 'K06'";
    } else {
      branchQuery = "AND h.sd_cab = ? AND h.sd_workshop = 'K06'";
      params.push(cabang);
    }
  } else if (user?.cabang === "KDC" || !user?.cabang) {
    // KDC atau Tanpa Token (Debug) bisa lihat semua atau filter per cabang
    if (cabang && cabang !== "ALL") {
      branchQuery = "AND h.sd_cab = ?";
      params.push(cabang);
    }
  } else {
    // [PERBAIKAN]: Toko bisa lihat data yang dibuat cabangnya
    // ATAU data yang memang ditujukan untuk cabangnya (berdasarkan prefix nomor)
    branchQuery = "AND (h.sd_cab = ? OR h.sd_nomor LIKE ?)";
    params.push(user.cabang, `${user.cabang}%`);
  }

  const query = `
        SELECT 
            x.Nomor, 
            x.Tanggal, 
            x.NamaDTF, 
            x.Jumlah, 
            x.Titik, 
            (x.Jumlah * x.Titik) AS TotalTitik, 
            x.TotalHarga,
            x.NoSoDtfRiil, 
            x.Sales, x.BagDesain, x.KdCus, x.Customer, x.Kain, 
            x.Finishing, x.Workshop, x.Keterangan, x.AlasanClose, x.Created, x.Close,
            x.UserModified, x.DateModified,
            
            IFNULL(
               (SELECT MAX(tr_revisi_ke) FROM tsodtf_trial_revisi WHERE tr_nomor = x.Nomor), 
               0
            ) AS RevisiKe,
            
            -- [PERBAIKAN KUNCI] Penentu tulisan Status di Chip Vue
            CASE
              WHEN x.NoSoDtfRiil <> '' AND x.NoSoDtfRiil IS NOT NULL THEN 'Closed (Jadi SO)'
              WHEN x.AlasanClose <> '' AND x.AlasanClose IS NOT NULL THEN 'Closed (Batal)'
              WHEN x.Close = 'Y' THEN 'Closed'
              ELSE 'Open'
            END AS status
        FROM (
            SELECT 
                h.sd_nomor AS Nomor, 
                DATE_FORMAT(h.sd_tanggal, '%d-%m-%Y') AS Tanggal, 
                h.sd_nama AS NamaDTF,
                IFNULL((SELECT SUM(i.sdd_jumlah) FROM tsodtf_dtl i WHERE i.sdd_nomor = h.sd_nomor), 0) AS Jumlah,
                IFNULL((SELECT SUM(i.sdd_jumlah * i.sdd_harga) FROM tsodtf_dtl i WHERE i.sdd_nomor = h.sd_nomor), 0) AS TotalHarga,
                IFNULL((SELECT COUNT(*) FROM tsodtf_dtl2 i WHERE i.sdd2_nomor = h.sd_nomor), 0) AS Titik,
                
                -- [PERBAIKAN RELASI] Tarik NoSO Riil dari relasi sd_trial_ref yang baru
                IFNULL((SELECT r.sd_nomor FROM tsodtf_hdr r WHERE r.sd_trial_ref = h.sd_nomor LIMIT 1), "") AS NoSoDtfRiil,
                
                s.sal_nama AS Sales, h.sd_desain AS BagDesain, h.sd_workshop AS Workshop,
                h.sd_cus_kode AS KdCus, c.cus_nama AS Customer, h.sd_kain AS Kain, h.sd_finishing AS Finishing,
                
                IFNULL(h.sd_ket, '') AS Keterangan, 
                IFNULL(h.sd_alasan, '') AS AlasanClose,
                IFNULL(h.sd_closing, 'N') AS Close,
                
                h.user_create AS Created, h.user_modified AS UserModified,
                h.date_modified AS DateModified, h.sd_cab
            FROM tsodtf_hdr h
            LEFT JOIN tcustomer c ON c.cus_kode = h.sd_cus_kode
            LEFT JOIN kencanaprint.tsales s ON s.sal_kode = h.sd_sal_kode
            
            WHERE h.sd_tanggal >= CONCAT(?, ' 00:00:00') AND h.sd_tanggal <= CONCAT(?, ' 23:59:59')
            AND h.sd_trial = 'Y' 
            ${branchQuery} 
        ) x
        ${status === "belum_so" ? "WHERE x.NoSoDtfRiil = '' AND x.Close <> 'Y'" : ""}
        ORDER BY x.Tanggal DESC, x.Nomor DESC;
    `;

  // Debugging log baru yang lebih tajam
  console.log("\n--- DEBUG GET LIST ---");
  console.log("SQL Params:", params);
  console.log("Branch Query:", branchQuery);

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
    throw new Error("Gagal menutup SO DTF Trial, nomor tidak ditemukan.");
  }
  return { message: "SO DTF Trial berhasil ditutup." };
};

const remove = async (nomor, user) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
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

    if (
      user.cabang !== "KDC" &&
      user.cabang !== record.sd_nomor.substring(0, 3)
    ) {
      throw new Error(
        `Anda tidak berhak menghapus data milik cabang ${record.sd_nomor.substring(0, 3)}.`,
      );
    }
    if (record.NoSO) throw new Error("Sudah dibuat SO, tidak bisa dihapus.");
    if (record.NoINV)
      throw new Error("Sudah dibuat Invoice, tidak bisa dihapus.");
    if (record.Close === "Y")
      throw new Error("Transaksi sudah ditutup, tidak bisa dihapus.");

    await connection.query("DELETE FROM tsodtf_hdr WHERE sd_nomor = ?", [
      nomor,
    ]);

    await connection.commit();

    const cabang = nomor.substring(0, 3);
    const imagePath = path.join(
      process.cwd(),
      "../public",
      "images",
      "sodtf",
      cabang,
      `${nomor}.jpg`,
    );
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    return { message: `SO DTF Trial ${nomor} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw new Error(error.message || "Gagal menghapus data.");
  } finally {
    connection.release();
  }
};

const exportHeader = async (filters, user) => {
  return await getSoDtfList(filters, user);
};

const exportDetail = async (payload) => {
  const { nomors } = payload;
  if (!nomors || nomors.length === 0) return [];
  const placeholders = nomors.map(() => "?").join(",");

  const query = `
        SELECT 
            h.sd_nomor AS Nomor, 
            DATE_FORMAT(h.sd_tanggal, '%d-%m-%Y') AS Tanggal, 
            h.sd_nama AS NamaDTF,
            (SELECT SUM(i.sdd_jumlah) FROM tsodtf_dtl i WHERE i.sdd_nomor = h.sd_nomor) AS JmlHeader,
            (SELECT COUNT(*) FROM tsodtf_dtl2 i WHERE i.sdd2_nomor = h.sd_nomor) AS Titik,
            IFNULL((SELECT r.sd_nomor FROM tsodtf_hdr r WHERE r.sd_ket LIKE CONCAT('%', h.sd_nomor, '%') AND r.sd_nomor NOT LIKE '%.TRL.%' LIMIT 1), "") AS NoSoDtfRiil,
            s.sal_nama AS Sales, 
            c.cus_nama AS Customer,
            d.sdd_ukuran AS Ukuran, 
            d.sdd_jumlah AS Jumlah
        FROM tsodtf_hdr h
        JOIN tsodtf_dtl d ON h.sd_nomor = d.sdd_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = h.sd_cus_kode
        LEFT JOIN kencanaprint.tsales s ON s.sal_kode = h.sd_sal_kode
        WHERE h.sd_nomor IN (${placeholders})
        ORDER BY h.sd_nomor, d.sdd_nourut
    `;

  const [data] = await pool.query(query, nomors);
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
