const pool = require("../config/database");
const xlsx = require("xlsx");

/**
 * Helper untuk mengubah format waktu desimal Excel menjadi string HH:mm:ss
 */
const formatExcelTime = (excelTime) => {
  if (excelTime === undefined || excelTime === null) return "00:00:00";

  // Jika formatnya sudah string dari sananya (misal file CSV)
  if (typeof excelTime === "string") {
    return excelTime.trim();
  }

  // Jika formatnya desimal bawaan Excel (misal 0.5 = 12:00:00)
  if (typeof excelTime === "number") {
    let totalSeconds = Math.round(excelTime * 86400); // 24 jam * 60 menit * 60 detik
    let hours = Math.floor(totalSeconds / 3600);
    let minutes = Math.floor((totalSeconds % 3600) / 60);
    let seconds = totalSeconds % 60;

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return "00:00:00";
};

/**
 * Mengambil daftar log mesin DTF dengan filter
 */
const getLogList = async (filters, user) => {
  const { startDate, endDate, cabang, search } = filters;
  const userCabang = user?.cabang || "";

  let params = [startDate, endDate];
  let branchQuery = "";

  if (userCabang === "KDC" || userCabang === "K06") {
    if (cabang && cabang !== "ALL") {
      branchQuery = "AND cabang = ?";
      params.push(cabang);
    }
  } else {
    branchQuery = "AND cabang = ?";
    params.push(userCabang);
  }

  let searchQuery = "";
  if (search) {
    searchQuery = "AND (nama_file LIKE ? OR nomor_so LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }

  const query = `
    SELECT * FROM tdtf_machine_log 
    WHERE tanggal BETWEEN ? AND ? 
    ${branchQuery} ${searchQuery}
    ORDER BY tanggal DESC, waktu_mulai DESC
  `;

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Memproses file Excel/CSV dari log mesin DTF dan memasukkannya ke database
 */
const importLogMesin = async (fileBuffer, user) => {
  const connection = await pool.getConnection();

  try {
    const workbook = xlsx.read(fileBuffer, { type: "buffer" });

    let sheetName = workbook.SheetNames.find((s) =>
      s.toLowerCase().includes("task detail"),
    );
    if (!sheetName) sheetName = workbook.SheetNames[0];

    const worksheet = workbook.Sheets[sheetName];
    const rawData = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

    if (rawData.length < 2) {
      throw new Error("File kosong atau format tidak sesuai.");
    }

    let successCount = 0;
    let duplicateCount = 0;

    await connection.beginTransaction();

    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length < 5) continue;

      const rawDate = row[1];

      // [PERBAIKAN] Gunakan fungsi formatExcelTime di sini
      const startTime = formatExcelTime(row[2]);
      const endTime = formatExcelTime(row[3]);

      const taskName = row[4];
      const material = row[5];
      const width = parseFloat(row[6]) || 0;
      const length = parseFloat(row[7]) || 0;
      const copyQty = parseInt(row[8]) || 0;
      const squareMeter = parseFloat(row[9]) || 0;
      const printTime = row[10];
      const statusPrint = row[12];

      if (!rawDate || !row[2]) continue;

      const dateStr = String(rawDate);
      const formattedDate =
        dateStr.length === 8
          ? `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`
          : null;

      if (!formattedDate) continue;

      let nomorSo = null;
      const soRegex = /[A-Z0-9]{3}\.SD\.\d{4}\.\d{4}/i;
      const match = String(taskName).match(soRegex);
      if (match) {
        nomorSo = match[0].toUpperCase();
      }

      const query = `
        INSERT IGNORE INTO tdtf_machine_log (
          cabang, tanggal, waktu_mulai, waktu_selesai, nama_file, material, 
          lebar_m, panjang_m, qty_copy, luas_m2, durasi_print, status_print, 
          nomor_so, user_import, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;

      const [result] = await connection.query(query, [
        user.cabang,
        formattedDate,
        startTime,
        endTime,
        taskName || "",
        material || "",
        width,
        length,
        copyQty,
        squareMeter,
        printTime || "",
        statusPrint || "",
        nomorSo,
        user.kode,
      ]);

      if (result.affectedRows > 0) {
        successCount++;
      } else {
        duplicateCount++;
      }
    }

    await connection.commit();

    return {
      message: `Import berhasil. ${successCount} data baru ditambahkan, ${duplicateCount} data dilewati (duplikat).`,
      successCount,
      duplicateCount,
    };
  } catch (error) {
    await connection.rollback();
    console.error("Error import log mesin:", error);
    throw new Error(
      error.message || "Terjadi kesalahan saat memproses file Excel.",
    );
  } finally {
    connection.release();
  }
};

module.exports = {
  getLogList,
  importLogMesin,
};
