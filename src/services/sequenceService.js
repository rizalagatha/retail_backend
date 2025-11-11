const { format } = require("date-fns");

// ============================================
// HELPER: Atomic increment sequence
// ============================================

const incrementSequence = async (connection, seqName, seqDate) => {
  try {
    // Step 1: Insert jika belum ada (ignore kalau sudah ada)
    await connection.query(
      `INSERT IGNORE INTO tdc_sequence (seq_name, seq_value, seq_date) 
       VALUES (?, 0, ?)`,
      [seqName, seqDate]
    );

    // Step 2: Increment nilai
    await connection.query(
      `UPDATE tdc_sequence 
       SET seq_value = seq_value + 1 
       WHERE seq_name = ? AND seq_date = ?`,
      [seqName, seqDate]
    );

    // Step 3: Ambil nilai terbaru
    const [rows] = await connection.query(
      `SELECT seq_value FROM tdc_sequence 
       WHERE seq_name = ? AND seq_date = ?`,
      [seqName, seqDate]
    );

    console.log(
      `[LOG] Sequence incremented: ${seqName}, new value: ${rows[0].seq_value}`
    );
    return rows[0].seq_value;
  } catch (error) {
    console.error("Error incrementing sequence:", error);
    throw error;
  }
};

// ============================================
// GENERATE NOMOR TERIMA (KDC.TS.YYMMM.XXXX)
// ============================================

const generateNomorTerima = async (connection, tanggal) => {
  const yearMonth = format(new Date(tanggal), "yyMM");
  const prefix = `KDC.TS.${yearMonth}.`;
  const seqName = `TS_${yearMonth}`;
  const seqDate = format(new Date(tanggal), "yyyy-MM-dd");

  const nextNum = await incrementSequence(connection, seqName, seqDate);

  return `${prefix}${nextNum.toString().padStart(4, "0")}`;
};

// ============================================
// GENERATE NOMOR SJ GARMEN (SG/KP/XXXXX/YYYY)
// ============================================

const generateNomorSjGarmen = async (connection, tanggal) => {
  const year = format(new Date(tanggal), "yyyy");
  const prefix = "SJ_GARMEN";
  const seqName = `${prefix}_${year}`;
  const seqDate = format(new Date(tanggal), "yyyy-MM-dd");

  const nextNum = await incrementSequence(connection, seqName, seqDate);

  const nomorFormatted = (100000 + nextNum).toString().substring(1);
  return `SG/KP/${nomorFormatted}/${year}`;
};

// ============================================
// GENERATE NOMOR MUTASI (KDC.MTS.YYMMM.XXXXX)
// ============================================

const generateNomorMutasi = async (connection, tanggal) => {
  const yearMonth = format(new Date(tanggal), "yyMM");
  const prefix = `KDC.MTS.${yearMonth}`;
  const seqName = `MTS_${yearMonth}`;
  const seqDate = format(new Date(tanggal), "yyyy-MM-dd");

  const nextNum = await incrementSequence(connection, seqName, seqDate);

  return {
    prefix,
    lastNum: nextNum - 1, // Return last used number
    nextNomor: `${prefix}.${nextNum.toString().padStart(5, "0")}`,
  };
};

// ============================================
// GENERATE NOMOR SJ STORE (KDC.SJ.YYMMM.XXXX)
// ============================================

const generateNomorSjStore = async (connection, tanggal) => {
  const yearMonth = format(new Date(tanggal), "yyMM");
  const prefix = `KDC.SJ.${yearMonth}.`;
  const seqName = `SJ_STORE_${yearMonth}`;
  const seqDate = format(new Date(tanggal), "yyyy-MM-dd");

  const nextNum = await incrementSequence(connection, seqName, seqDate);

  return {
    prefix,
    lastNum: nextNum - 1, // Return last used number
    nextNomor: `${prefix}${nextNum.toString().padStart(4, "0")}`,
  };
};

const generateNomorTolakStbj = async (connection, tanggal) => {
  const yearMonth = format(new Date(tanggal), "yyMM");
  const prefix = `KDC.TL.${yearMonth}`;
  const seqName = `TL_${yearMonth}`;
  const seqDate = format(new Date(tanggal), "yyyy-MM-dd");

  const nextNum = await incrementSequence(connection, seqName, seqDate);

  return `${prefix}${nextNum.toString().padStart(5, "0")}`;
};

const generateNomorTerimaRepair = async (connection, tanggal) => {
  const yearMonth = format(new Date(tanggal), "yyMM");
  const prefix = `KDC.GT.${yearMonth}.`;
  const seqName = `GT_${yearMonth}`;
  const seqDate = format(new Date(tanggal), "yyyy-MM-dd");

  const nextNum = await incrementSequence(connection, seqName, seqDate);

  return `${prefix}${nextNum.toString().padStart(4, "0")}`;
};

// ============================================
// EXPORT FUNCTIONS
// ============================================

module.exports = {
  generateNomorTerima,
  generateNomorSjGarmen,
  generateNomorMutasi,
  generateNomorSjStore,
  generateNomorTolakStbj,
  generateNomorTerimaRepair,
  incrementSequence,
};
