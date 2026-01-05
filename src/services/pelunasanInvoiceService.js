const pool = require("../config/database");
const { format } = require("date-fns");

// Helper: Generate Nomor Bukti Setoran (Format: K01.STR.2310.0001)
const generateNewSetorNumber = async (connection, cabang, tanggal) => {
  const date = new Date(tanggal);
  const prefix = `${cabang}.STR.${format(date, "yyMM")}.`;
  const query = `
    SELECT IFNULL(MAX(RIGHT(sh_nomor, 4)), 0) + 1 AS next_num
    FROM tsetor_hdr 
    WHERE sh_nomor LIKE ?;
  `;
  const [rows] = await connection.query(query, [`${prefix}%`]);
  const nextNumber = rows[0].next_num.toString().padStart(4, "0");
  return `${prefix}${nextNumber}`;
};

// 1. Ambil Daftar Invoice Belum Lunas (Outstanding)
const getOutstandingPiutang = async (customerKode, user) => {
  // [FIX] Mengembalikan Saldo Piutang Murni (Debet - Kredit)
  // Tidak dikurangi Fee di sini, agar konsisten dengan kartu piutang
  const query = `
    SELECT 
        h.ph_nomor,
        h.ph_tanggal,
        h.ph_inv_nomor AS inv_nomor,
        
        i.inv_mp_nama AS marketplace,
        i.inv_mp_nomor_pesanan AS no_pesanan,
        i.inv_mp_biaya_platform, 
        
        -- Saldo Real di Buku Besar (Ledger)
        (
           IFNULL((SELECT SUM(pd_debet) FROM tpiutang_dtl WHERE pd_ph_nomor = h.ph_nomor), 0) - 
           IFNULL((SELECT SUM(pd_kredit) FROM tpiutang_dtl WHERE pd_ph_nomor = h.ph_nomor), 0)
        ) AS sisa_tagihan

    FROM tpiutang_hdr h
    JOIN tinv_hdr i ON i.inv_nomor = h.ph_inv_nomor
    WHERE i.inv_cab = ? 
      AND h.ph_cus_kode = ?
    
    HAVING sisa_tagihan > 100 -- Toleransi pembulatan perak
    ORDER BY h.ph_tanggal ASC;
  `;

  const [rows] = await pool.query(query, [user.cabang, customerKode]);
  return rows;
};

// 2. Simpan Transaksi Pelunasan (FIXED FEE DEDUCTION)
const savePelunasan = async (payload, user) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const {
      customerKode,
      invoices,
      paymentDate,
      paymentMethod,
      bankAccount,
      keterangan,
    } = payload;

    // --- 1. HITUNG ULANG TOTAL REAL (NET) UNTUK HEADER ---
    // Kita tidak bisa percaya bulat-bulat 'totalBayar' dari frontend jika ada Fee yang tersembunyi.
    // Kita hitung total uang real yang masuk ke bank.
    let realTotalMoney = 0;

    // Kita butuh loop dulu untuk validasi & hitung total
    for (const inv of invoices) {
      const bayarGross = Number(inv.bayar);

      // Cek Fee Platform per invoice
      const [invData] = await connection.query(
        `SELECT inv_mp_biaya_platform FROM tinv_hdr WHERE inv_nomor = ?`,
        [inv.inv_nomor]
      );
      const fee = Number(invData[0]?.inv_mp_biaya_platform || 0);

      // Uang Real = Bayar Gross - Fee
      // (Pastikan tidak minus, minimal 0)
      const bayarNet = Math.max(0, bayarGross - fee);
      realTotalMoney += bayarNet;
    }

    // --- 2. GENERATE NOMOR ---
    const nomorSetor = await generateNewSetorNumber(
      connection,
      user.cabang,
      paymentDate
    );
    const idrecSetor = `${user.cabang}PL${format(
      new Date(),
      "yyyyMMddHHmmssSSS"
    )}`;

    let jenisBayar = 0;
    if (paymentMethod === "TRANSFER") jenisBayar = 1;
    if (paymentMethod === "GIRO") jenisBayar = 2;

    // --- 3. INSERT HEADER SETORAN (GUNAKAN TOTAL REAL/NET) ---
    await connection.query(
      `INSERT INTO tsetor_hdr (
          sh_idrec, sh_nomor, sh_cus_kode, sh_tanggal, sh_jenis, sh_nominal, 
          sh_akun, sh_norek, sh_tgltransfer, sh_ket, user_create, date_create
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        idrecSetor,
        nomorSetor,
        customerKode,
        paymentDate,
        jenisBayar,
        realTotalMoney, // <-- PAKAI REAL TOTAL
        bankAccount?.kode || "",
        bankAccount?.rekening || "",
        paymentDate,
        keterangan || "PELUNASAN PIUTANG MARKETPLACE",
        user.kode,
      ]
    );

    // [SAFETY NET] Hapus sisa-sisa error sebelumnya
    await connection.query("DELETE FROM tsetor_dtl WHERE sd_sh_nomor = ?", [
      nomorSetor,
    ]);

    // --- 4. LOOP DETAIL & INSERT ---
    const batchTs = format(new Date(), "yyMMddHHmmss");
    let urut = 1;
    let globalCounter = 1;

    for (const inv of invoices) {
      const bayarGross = Number(inv.bayar);
      if (bayarGross <= 0) continue;

      // 4a. Ambil Data Fee & Piutang Header
      const [invRow] = await connection.query(
        `SELECT inv_mp_biaya_platform FROM tinv_hdr WHERE inv_nomor = ?`,
        [inv.inv_nomor]
      );
      const feePlatform = Number(invRow[0]?.inv_mp_biaya_platform || 0);

      // Cari Header Piutang
      let phNomor = inv.ph_nomor;
      if (!phNomor) {
        const [hdr] = await connection.query(
          `SELECT ph_nomor FROM tpiutang_hdr WHERE ph_inv_nomor = ? LIMIT 1`,
          [inv.inv_nomor]
        );
        if (!hdr.length)
          throw new Error(`Piutang tidak ditemukan: ${inv.inv_nomor}`);
        phNomor = hdr[0].ph_nomor;
      }

      // 4b. Hitung Split: Uang vs Fee
      // Uang Real yang masuk ke Kas/Bank
      const uangReal = Math.max(0, bayarGross - feePlatform);

      // ID Unik
      const angsurIdUang = `${user.cabang}P${batchTs}-${globalCounter++}`;
      const angsurIdFee = `${user.cabang}F${batchTs}-${globalCounter++}`;
      const idrecDtl = `${user.cabang}D${batchTs}-${globalCounter}`;

      // --- A. INSERT TSETOR_DTL (Hanya Uang Real) ---
      if (uangReal > 0) {
        await connection.query(
          `INSERT INTO tsetor_dtl (sd_idrec, sd_sh_nomor, sd_tanggal, sd_inv, sd_bayar, sd_ket, sd_nourut, sd_angsur) 
             VALUES (?, ?, ?, ?, ?, 'PELUNASAN', ?, ?)`,
          [
            idrecDtl,
            nomorSetor,
            paymentDate,
            inv.inv_nomor,
            uangReal,
            urut,
            angsurIdUang,
          ]
        );

        // --- B. POTONG PIUTANG 1 (Uang Real) ---
        // [FIX] Corrected placeholders and values
        await connection.query(
          `INSERT INTO tpiutang_dtl (pd_ph_nomor, pd_tanggal, pd_uraian, pd_debet, pd_kredit, pd_ket, pd_sd_angsur) 
             VALUES (?, ?, ?, 0, ?, ?, ?)`,
          [
            phNomor,
            paymentDate,
            `Pelunasan ${inv.inv_nomor}`, // pd_uraian
            uangReal, // pd_kredit
            `VIA ${paymentMethod}`, // pd_ket
            angsurIdUang, // pd_sd_angsur
          ]
        );
      }

      // --- C. POTONG PIUTANG 2 (Fee Platform - Non Tunai) ---
      const [cekFee] = await connection.query(
        `SELECT COUNT(*) as cnt FROM tpiutang_dtl WHERE pd_ph_nomor = ? AND pd_ket = 'BIAYA LAYANAN'`,
        [phNomor]
      );

      if (feePlatform > 0 && cekFee[0].cnt === 0) {
        await connection.query(
          `INSERT INTO tpiutang_dtl (pd_ph_nomor, pd_tanggal, pd_uraian, pd_debet, pd_kredit, pd_ket, pd_sd_angsur) 
             VALUES (?, ?, 'Potongan Biaya Admin MP', 0, ?, 'BIAYA LAYANAN', ?)`,
          [
            phNomor,
            paymentDate,
            feePlatform, // pd_kredit
            angsurIdFee, // pd_sd_angsur
          ]
        );
      }

      // --- D. UPDATE INVOICE HEADER ---
      // Update inv_pundiamal dengan TOTAL GROSS (Uang + Fee) agar Sisa Piutang habis
      // inv_pundiamal = uangReal + feePlatform = bayarGross
      await connection.query(
        `UPDATE tinv_hdr SET inv_pundiamal = IFNULL(inv_pundiamal, 0) + ? WHERE inv_nomor = ?`,
        [bayarGross, inv.inv_nomor]
      );

      urut++;
    }

    await connection.commit();
    return { message: "Pelunasan berhasil disimpan.", nomor: nomorSetor };
  } catch (error) {
    await connection.rollback();
    console.error("[Pelunasan] Failed:", error);
    throw new Error(error.message || "Gagal menyimpan transaksi.");
  } finally {
    connection.release();
  }
};

// [BARU] 3. Ambil History Pelunasan (Browse)
const getPaymentHistory = async (filters, user) => {
  const { page = 1, itemsPerPage = 10, term, startDate, endDate } = filters;
  const offset = (page - 1) * itemsPerPage;

  let whereClause = `WHERE h.sh_cab = ? AND h.sh_ket LIKE '%PELUNASAN%'`;
  const params = [user.cabang];

  if (startDate && endDate) {
    whereClause += ` AND h.sh_tanggal BETWEEN ? AND ?`;
    params.push(startDate, endDate);
  }

  if (term) {
    whereClause += ` AND (h.sh_nomor LIKE ? OR c.cus_nama LIKE ?)`;
    params.push(`%${term}%`, `%${term}%`);
  }

  // Query Count
  const countQuery = `
    SELECT COUNT(*) as total 
    FROM tsetor_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.sh_cus_kode
    ${whereClause}
  `;
  const [countRows] = await pool.query(countQuery, params);

  // Query Data
  const dataQuery = `
    SELECT 
      h.sh_nomor, 
      h.sh_tanggal, 
      h.sh_cus_kode, 
      c.cus_nama,
      h.sh_jenis, -- 1=Transfer, 0=Tunai
      h.sh_nominal AS total_bayar,
      h.sh_ket,
      h.user_create
    FROM tsetor_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.sh_cus_kode
    ${whereClause}
    ORDER BY h.sh_tanggal DESC, h.sh_nomor DESC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await pool.query(dataQuery, [
    ...params,
    Number(itemsPerPage),
    Number(offset),
  ]);
  return { items: rows, total: countRows[0].total };
};

// [BARU] 4. Ambil Detail Satu Pelunasan (Read View)
const getPaymentDetail = async (nomor, user) => {
  // A. Header
  const headerQuery = `
    SELECT 
      h.*, 
      c.cus_nama, c.cus_alamat,
      CASE WHEN h.sh_jenis = 1 THEN 'TRANSFER' 
           WHEN h.sh_jenis = 2 THEN 'GIRO' 
           ELSE 'TUNAI' END as metode_bayar_desc
    FROM tsetor_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.sh_cus_kode
    WHERE h.sh_nomor = ? AND h.sh_cab = ?
  `;
  const [headerRows] = await pool.query(headerQuery, [nomor, user.cabang]);
  if (headerRows.length === 0)
    throw new Error("Data pelunasan tidak ditemukan.");

  // B. Detail Invoice yang dibayar
  const detailQuery = `
    SELECT 
      d.sd_inv AS inv_nomor,
      d.sd_bayar AS nominal_bayar,
      i.inv_tanggal,
      i.inv_mp_nomor_pesanan, -- No Pesanan Marketplace
      i.inv_mp_nama           -- Nama Marketplace
    FROM tsetor_dtl d
    LEFT JOIN tinv_hdr i ON i.inv_nomor = d.sd_inv
    WHERE d.sd_sh_nomor = ?
    ORDER BY d.sd_nourut ASC
  `;
  const [detailRows] = await pool.query(detailQuery, [nomor]);

  return { header: headerRows[0], details: detailRows };
};

module.exports = {
  getOutstandingPiutang,
  savePelunasan,
  getPaymentHistory,
  getPaymentDetail,
};
