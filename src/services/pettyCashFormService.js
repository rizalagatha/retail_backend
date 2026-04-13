const fs = require("fs");
const path = require("path");
const pool = require("../config/database");
const { format } = require("date-fns");
const { get } = require("http");

const generateIdRec = (cab, type) => {
  const timestamp = format(new Date(), "yyyyMMddHHmmssSSS");
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${cab}${type}${timestamp}${random}`;
};

const generateNomor = async (cab, conn) => {
  // FORMAT BARU: CABANG.PC.YYMM.
  const prefix = `${cab}.PC.${format(new Date(), "yyMM")}.`;

  const [rows] = await conn.query(
    "SELECT MAX(pc_nomor) as last FROM tpettycash_hdr WHERE pc_nomor LIKE ?",
    [prefix + "%"],
  );
  const lastNo = rows[0].last ? parseInt(rows[0].last.split(".").pop()) : 0;
  return prefix + (lastNo + 1).toString().padStart(4, "0");
};

// --- RUMUS SALDO BERJALAN ---
// Modal Awal (Misal 1 Juta) + Semua Pemasukan (Debet) - Semua Pengeluaran (Kredit)
const getCurrentSaldo = async (cabang, conn) => {
  const query = `
    SELECT 
      1000000 + 
      IFNULL(SUM(CASE WHEN mut_tipe = 'DEBET' THEN mut_nominal ELSE 0 END), 0) - 
      IFNULL(SUM(CASE WHEN mut_tipe = 'KREDIT' THEN mut_nominal ELSE 0 END), 0) AS saldo_aktif
    FROM tpettycash_mutasi 
    WHERE mut_cabang = ?
  `;
  const [rows] = await conn.query(query, [cabang]);
  return parseFloat(rows[0].saldo_aktif);
};

const saveData = async (data, files, user) => {
  const { header, details, isEditMode } = data;

  const parsedHeader = JSON.parse(header);
  const parsedDetails = JSON.parse(details);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let nomor = parsedHeader.nomor;
    let idrecHdr = parsedHeader.idrec;

    const nominalTerpakai = parseFloat(parsedHeader.terpakai);

    if (!isEditMode || !nomor) {
      // ========================================================
      // [MODE BARU] Tarik Saldo Real-Time
      // ========================================================
      const saldoBerjalan = await getCurrentSaldo(user.cabang, connection);
      const sisaSaldoSetelahIni = saldoBerjalan - nominalTerpakai;

      nomor = await generateNomor(user.cabang, connection);
      idrecHdr = generateIdRec(user.cabang, "PCH");

      const sqlHdr = `INSERT INTO tpettycash_hdr (pc_idrec, pc_nomor, pc_tanggal, pc_cab, pc_modal, pc_total_terpakai, pc_saldo, pc_status, pc_ket, user_create, date_create) VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, NOW())`;
      await connection.query(sqlHdr, [
        idrecHdr,
        nomor,
        parsedHeader.tanggal,
        user.cabang,
        saldoBerjalan, // <-- Modal dicatat saat ini
        nominalTerpakai,
        sisaSaldoSetelahIni,
        parsedHeader.keterangan,
        user.kode,
      ]);

      // Insert Mutasi sebagai KREDIT
      await connection.query(
        `INSERT INTO tpettycash_mutasi (mut_cabang, mut_tanggal, mut_nomor_bukti, mut_tipe, mut_nominal, mut_keterangan) VALUES (?, ?, ?, 'KREDIT', ?, ?)`,
        [
          user.cabang,
          parsedHeader.tanggal,
          nomor,
          nominalTerpakai,
          parsedHeader.keterangan || "Pengeluaran PC",
        ],
      );
    } else {
      // ========================================================
      // [MODE EDIT] Gunakan Modal Lama, Jangan Hitung Ulang!
      // ========================================================
      const modalLama = parseFloat(parsedHeader.modal); // Tarik dari modal yang dikunci frontend
      const sisaSaldoSetelahIni = modalLama - nominalTerpakai;

      // Update Header PC (Modal tidak berubah)
      const sqlHdr = `UPDATE tpettycash_hdr SET pc_tanggal = ?, pc_total_terpakai = ?, pc_saldo = ?, pc_ket = ?, user_modified = ?, date_modified = NOW() WHERE pc_nomor = ?`;
      await connection.query(sqlHdr, [
        parsedHeader.tanggal,
        nominalTerpakai,
        sisaSaldoSetelahIni,
        parsedHeader.keterangan,
        user.kode,
        nomor,
      ]);

      // Hapus detail lama
      await connection.query("DELETE FROM tpettycash_dtl WHERE pcd_nomor = ?", [
        nomor,
      ]);

      // Update Mutasi KREDIT dengan nominal baru
      await connection.query(
        "UPDATE tpettycash_mutasi SET mut_nominal = ?, mut_tanggal = ?, mut_keterangan = ? WHERE mut_nomor_bukti = ? AND mut_tipe = 'KREDIT'",
        [
          nominalTerpakai,
          parsedHeader.tanggal,
          parsedHeader.keterangan || "Pengeluaran PC",
          nomor,
        ],
      );
    }

    const finalDir = path.join(process.cwd(), "public/uploads/pettycash");
    if (!fs.existsSync(finalDir)) {
      fs.mkdirSync(finalDir, { recursive: true });
    }

    // --- LOGIKA MULTIPLE INSERT DETAILS BARU ---
    let urut = 1;
    for (const item of parsedDetails) {
      let fileNames = item.existingFiles || [];

      const prefixKey = `file_${item.index}_`;
      const newFiles = files
        ? files.filter((f) => f.fieldname.startsWith(prefixKey))
        : [];

      for (const uploadedFile of newFiles) {
        const ext = path.extname(uploadedFile.originalname);
        const finalFileName = `NOTA-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
        const finalPath = path.join(finalDir, finalFileName);

        if (fs.existsSync(uploadedFile.path)) {
          fs.renameSync(uploadedFile.path, finalPath);
          fileNames.push(finalFileName);
        }
      }

      const finalFilesString =
        fileNames.length > 0 ? fileNames.join(",") : null;

      const idrecDtl = generateIdRec(user.cabang, "PCD");
      const sqlDtl = `
        INSERT INTO tpettycash_dtl 
        (pcd_idrec, pcd_nomor, pcd_tanggal, pcd_pcv, pcd_keterangan, pcd_no_transaksi, pcd_kategori, pcd_nominal, pcd_file, pcd_nourut)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      await connection.query(sqlDtl, [
        idrecDtl,
        nomor,
        item.tanggal,
        item.pcv,
        item.keterangan,
        item.no_transaksi || null,
        item.kategori,
        item.nominal,
        finalFilesString,
        urut,
      ]);
      urut++;
    }

    await connection.commit();
    return { message: "Laporan Petty Cash berhasil disimpan.", nomor };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getDetail = async (nomor) => {
  const [headerRows] = await pool.query(
    "SELECT * FROM tpettycash_hdr WHERE pc_nomor = ?",
    [nomor],
  );
  if (headerRows.length === 0) throw new Error("Data tidak ditemukan");

  const headerData = headerRows[0];

  // ====================================================================
  // [AUTO-HEAL] KALKULASI MODAL MURNI
  // Hitung saldo dari tabel mutasi, TETAPI abaikan dokumen ini sendiri.
  // Ini akan menghasilkan nilai Modal yang benar-benar utuh sebelum terpakai.
  // ====================================================================
  const querySaldo = `
    SELECT 
      1000000 + 
      IFNULL(SUM(CASE WHEN mut_tipe = 'DEBET' THEN mut_nominal ELSE 0 END), 0) - 
      IFNULL(SUM(CASE WHEN mut_tipe = 'KREDIT' THEN mut_nominal ELSE 0 END), 0) AS saldo_murni
    FROM tpettycash_mutasi 
    WHERE mut_cabang = ? AND mut_nomor_bukti != ?
  `;
  const [saldoRows] = await pool.query(querySaldo, [headerData.pc_cab, nomor]);
  const realModal = parseFloat(saldoRows[0].saldo_murni);

  // Timpa nilai corrupt dari database dengan nilai asli yang benar
  headerData.pc_modal = realModal;
  headerData.pc_saldo = realModal - parseFloat(headerData.pc_total_terpakai);

  const [detailRows] = await pool.query(
    `SELECT 
      pcd_idrec,
      pcd_tanggal, 
      pcd_pcv, 
      pcd_kategori, 
      pcd_keterangan, 
      pcd_no_transaksi,
      pcd_nominal, 
      pcd_file 
    FROM tpettycash_dtl 
    WHERE pcd_nomor = ? 
    ORDER BY pcd_tanggal ASC, pcd_pcv ASC`,
    [nomor],
  );

  return { header: headerData, details: detailRows };
};

const approveClaim = async (nomor, userKode) => {
  const sql = `
    UPDATE tpettycash_hdr 
    SET pc_status = 'APPROVED', user_modified = ?, date_modified = NOW() 
    WHERE pc_nomor = ? AND pc_status = 'SUBMITTED'
  `;
  const [result] = await pool.query(sql, [userKode, nomor]);
  if (result.affectedRows === 0)
    throw new Error(
      "Gagal Approve. Data tidak ditemukan atau status bukan SUBMITTED.",
    );
  return { message: `Klaim ${nomor} telah disetujui.` };
};

const rejectClaim = async (nomor, userKode, alasan) => {
  const sql = `
    UPDATE tpettycash_hdr 
    SET pc_status = 'REJECTED', pc_ket_finance = ?, user_modified = ?, date_modified = NOW() 
    WHERE pc_nomor = ? AND pc_status = 'SUBMITTED'
  `;
  const [result] = await pool.query(sql, [alasan, userKode, nomor]);
  if (result.affectedRows === 0)
    throw new Error(
      "Gagal Reject. Data tidak ditemukan atau status bukan SUBMITTED.",
    );
  return { message: `Klaim ${nomor} telah ditolak.` };
};

const getPrintData = async (nomor) => {
  const query = `
    SELECT 
      h.pc_nomor, 
      h.pc_tanggal, 
      h.pc_cab,
      h.pc_ket,
      h.pc_modal,
      h.pc_total_terpakai,
      h.pc_saldo,
      h.pc_status,
      h.user_create,
      DATE_FORMAT(h.date_create, '%d-%m-%Y %H:%i:%s') AS created,
      g.gdg_nama,
      g.gdg_inv_nama,
      g.gdg_inv_alamat,
      g.gdg_inv_kota,
      g.gdg_inv_telp,
      d.pcd_tanggal,
      d.pcd_pcv,
      d.pcd_kategori,
      d.pcd_keterangan,
      d.pcd_nominal,
      d.pcd_file
    FROM tpettycash_hdr h
    LEFT JOIN tpettycash_dtl d ON d.pcd_nomor = h.pc_nomor
    LEFT JOIN tgudang g ON g.gdg_kode = h.pc_cab
    WHERE h.pc_nomor = ?;
  `;

  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) throw new Error("Data klaim tidak ditemukan.");

  const header = {
    nomor: rows[0].pc_nomor,
    tanggal: rows[0].pc_tanggal,
    cabang: rows[0].pc_cab,
    namaCabang: rows[0].gdg_nama,
    keterangan: rows[0].pc_ket,
    modal: rows[0].pc_modal,
    terpakai: rows[0].pc_total_terpakai,
    saldo: rows[0].pc_saldo,
    status: rows[0].pc_status,
    created: rows[0].created,
    user_create: rows[0].user_create,
    // Info Perusahaan dari Cabang terkait
    perush_nama: rows[0].gdg_inv_nama || "PT. KAOSAN JAYA ABADI",
    perush_alamat: `${rows[0].gdg_inv_alamat || ""}, ${rows[0].gdg_inv_kota || ""}`,
    perush_telp: rows[0].gdg_inv_telp,
  };

  const details = rows
    .filter((r) => r.pcd_pcv)
    .map((r) => ({
      tanggal: r.pcd_tanggal,
      pcv: r.pcd_pcv,
      kategori: r.pcd_kategori,
      keterangan: r.pcd_keterangan,
      nominal: r.pcd_nominal,
      file: r.pcd_file,
    }));

  return { header, details };
};

module.exports = {
  saveData,
  getDetail,
  approveClaim,
  rejectClaim,
  getPrintData,
  getCurrentSaldo,
};
