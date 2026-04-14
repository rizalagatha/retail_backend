const pool = require("../config/database");
const { format } = require("date-fns");

const getList = async (filters) => {
  const { startDate, endDate, cabang } = filters;

  let branchFilter = "";
  let params = [startDate, endDate];

  if (cabang && cabang !== "ALL") {
    branchFilter = " AND h.pc_cab = ? ";
    params.push(cabang);
  }

  const query = `
        SELECT 
            IFNULL(h.pck_nomor, h.pc_nomor) AS nomor_utama, 
            MAX(h.pc_idrec) AS idrec, 
            MAX(h.pck_nomor) AS pck_nomor,
            MAX(k.pck_bkm_nomor) AS bkm_nomor,

            MAX(k.date_create) AS date_submitted,
            MAX(k.date_acc) AS date_acc,
            MAX(k.date_approved) AS date_approved,
            MAX(k.date_transfer) AS date_transfer,
            MAX(k.date_received) AS date_received,
            
            IFNULL(MAX(k.pck_tanggal), MAX(h.pc_tanggal)) AS tanggal, 
            MAX(k.pck_receive_nominal) AS receive_nominal,
            MAX(h.pc_cab) AS cabang,
            MAX(g.gdg_nama) AS namaCabang,
            SUM(h.pc_total_terpakai) AS terpakai,
            
            -- =======================================================================
            -- [PERBAIKAN KUNCI 1] AUTO-HEAL TAMPILAN MODAL
            -- Jika modal di DB lebih kecil dari terpakai (karena bug sebelumnya), 
            -- sistem otomatis mengasumsikan Modal Asli = Modal Corrupt + Terpakai
            -- =======================================================================
            MAX(CASE WHEN h.pc_modal < h.pc_total_terpakai THEN h.pc_modal + h.pc_total_terpakai ELSE h.pc_modal END) AS modal, 
            
            -- =======================================================================
            -- [PERBAIKAN KUNCI 2] RUMUS SALDO YANG BENAR UNTUK GROUPING
            -- Saldo = Modal Asli (Max) dikurangi Total Keseluruhan Terpakai (Sum)
            -- Jangan pakai MIN(saldo) lagi karena bakal kacau kalau klaim digabung!
            -- =======================================================================
            MAX(CASE WHEN h.pc_modal < h.pc_total_terpakai THEN h.pc_modal + h.pc_total_terpakai ELSE h.pc_modal END) - SUM(h.pc_total_terpakai) AS saldo,
            
            MAX(tf.ptd_nomor) AS pck_pth_nomor,
            
            -- [BARU] Ambil Nomor BBK Realisasi dari Finance
            MAX(tf.ptd_jur_no) AS pck_bbk_finance,

            -- [PERBAIKAN STATUS] Cegah status RECEIVED mundur jadi ON_TRANSFER
            CASE 
                WHEN MAX(h.pc_status) = 'RECEIVED' THEN 'RECEIVED'
                WHEN MAX(tf.ptd_nomor) IS NOT NULL THEN 'ON_TRANSFER'
                ELSE MAX(h.pc_status) 
            END AS status, 
            
            IFNULL(MAX(k.pck_keterangan), GROUP_CONCAT(h.pc_ket SEPARATOR ' | ')) AS keterangan,
            MAX(h.user_create) AS userCreate,
            COUNT(h.pc_nomor) AS jumlah_nota
            
        FROM tpettycash_hdr h
        LEFT JOIN tgudang g ON g.gdg_kode = h.pc_cab
        LEFT JOIN tpettycash_klaim_hdr k ON k.pck_nomor = h.pck_nomor
        LEFT JOIN finance.tpengajuan_transfer_dtl tf ON tf.ptd_trs = h.pck_nomor
        
        WHERE h.pc_tanggal BETWEEN ? AND ?
        ${branchFilter}
        GROUP BY IFNULL(h.pck_nomor, h.pc_nomor)
        ORDER BY tanggal DESC, nomor_utama DESC`;

  const [rows] = await pool.query(query, params);
  return rows;
};

const submitData = async (nomor, userKode) => {
  const sql = `
    UPDATE tpettycash_hdr 
    SET pc_status = 'SUBMITTED', user_modified = ?, date_modified = NOW() 
    WHERE pc_nomor = ? AND pc_status IN ('DRAFT', 'REJECTED')
  `;

  const [result] = await pool.query(sql, [userKode, nomor]);

  if (result.affectedRows === 0) {
    throw new Error(
      "Gagal submit. Dokumen mungkin tidak ditemukan atau statusnya bukan DRAFT/REJECTED.",
    );
  }

  return { message: `Laporan ${nomor} berhasil dikirim ke Finance.` };
};

const submitKlaimKolektif = async (payload, user) => {
  // 1. Tambahkan 'approver' ke dalam destructuring payload
  const { nomorList, keterangan, approver } = payload;

  if (!nomorList || nomorList.length === 0) {
    throw new Error("Tidak ada dokumen Petty Cash yang dipilih.");
  }

  // Validasi tambahan: Pastikan approver ada
  if (!approver) {
    throw new Error("Otorisasi SPV diperlukan untuk mengajukan klaim.");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // --- (Bagian 1 & 2 tetap sama untuk hitung total dan generate nomor) ---
    const placeholders = nomorList.map(() => "?").join(",");
    const checkQuery = `SELECT SUM(pc_total_terpakai) as total_klaim FROM tpettycash_hdr WHERE pc_nomor IN (${placeholders}) AND pc_status IN ('DRAFT', 'REJECTED') AND pc_cab = ?`;
    const [checkRows] = await connection.query(checkQuery, [
      ...nomorList,
      user.cabang,
    ]);

    if (!checkRows[0].total_klaim) {
      throw new Error(
        "Dokumen tidak valid atau statusnya bukan DRAFT/REJECTED.",
      );
    }
    const totalKlaim = checkRows[0].total_klaim;

    const now = new Date();
    const yearMonth = format(now, "yyMM");
    const prefix = `${user.cabang}.KPC.${yearMonth}.`;
    const nomorQuery = `SELECT IFNULL(MAX(RIGHT(pck_nomor, 4)), 0) + 1 AS next_num FROM tpettycash_klaim_hdr WHERE pck_nomor LIKE ? FOR UPDATE`;
    const [nomorRows] = await connection.query(nomorQuery, [`${prefix}%`]);
    const pck_nomor = `${prefix}${nomorRows[0].next_num.toString().padStart(4, "0")}`;
    const pck_idrec = `${user.cabang}PK${format(now, "yyyyMMddHHmmss.SSS")}`;

    // 3. Update Insert ke tabel Header (Tambah kolom pck_acc)
    const sqlInsert = `
      INSERT INTO tpettycash_klaim_hdr 
      (pck_idrec, pck_nomor, pck_tanggal, pck_cab, pck_keterangan, pck_total, pck_status, pck_acc, date_acc, user_create, date_create) 
      VALUES (?, ?, CURDATE(), ?, ?, ?, 'SUBMITTED', ?, NULL, ?, NOW()) 
    `;

    await connection.query(sqlInsert, [
      pck_idrec,
      pck_nomor,
      user.cabang,
      keterangan,
      totalKlaim,
      approver, // Masih nyimpan nama Estu, tapi statusnya SUBMITTED
      user.kode,
    ]);

    // 4. Update tabel Petty Cash Lama (Tetap sama)
    const updateQuery = `UPDATE tpettycash_hdr SET pc_status = 'SUBMITTED', pck_nomor = ?, user_modified = ?, date_modified = NOW() WHERE pc_nomor IN (${placeholders})`;
    await connection.query(updateQuery, [pck_nomor, user.kode, ...nomorList]);

    await connection.commit();
    return {
      message: `Berhasil mengajukan klaim dengan nomor ${pck_nomor}`,
      pck_nomor,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getDraftsForKlaim = async ({ cabang, startDate, endDate }) => {
  const query = `
    SELECT 
        pc_nomor AS nomor, 
        pc_tanggal AS tanggal, 
        pc_total_terpakai AS terpakai, 
        pc_ket AS keterangan,
        pc_status AS status
    FROM tpettycash_hdr 
    WHERE pc_cab = ? 
      AND pc_status IN ('DRAFT', 'REJECTED')
      AND pc_tanggal BETWEEN ? AND ? -- [TAMBAHAN FILTER TANGGAL]
    ORDER BY pc_tanggal ASC
  `;
  const [rows] = await pool.query(query, [cabang, startDate, endDate]);
  return rows;
};

const accKlaim = async (pck_nomor, approver, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Update tabel Header Pengajuan Klaim (PCK)
    const updatePck = `
      UPDATE tpettycash_klaim_hdr 
      SET pck_status = 'ACC', pck_acc = ?, date_acc = NOW(), user_modified = ?, date_modified = NOW() 
      WHERE pck_nomor = ? AND pck_status = 'SUBMITTED'
    `;
    const [resPck] = await connection.query(updatePck, [
      approver,
      user.kode,
      pck_nomor,
    ]);

    if (resPck.affectedRows === 0) {
      throw new Error(
        "Gagal ACC. Pengajuan tidak ditemukan atau statusnya bukan SUBMITTED.",
      );
    }

    // 2. Update status semua PC yang terikat menjadi ACC (BUKAN APPROVED)
    const updatePc = `
      UPDATE tpettycash_hdr 
      SET pc_status = 'ACC', user_modified = ?, date_modified = NOW() 
      WHERE pck_nomor = ?
    `;
    // [PERBAIKAN] Tidak ada 'catatan' di sini, murni mengubah status ke ACC
    await connection.query(updatePc, [user.kode, pck_nomor]);

    await connection.commit();
    return {
      message: `Pengajuan ${pck_nomor} berhasil di-ACC oleh ${approver}.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// --- UNTUK BROWSE FINANCE ---
const getListKlaimFinance = async (filters) => {
  const { startDate, endDate, cabang, status } = filters;

  let branchFilter = "";
  let statusFilter = "";
  let params = [startDate, endDate];

  if (cabang && cabang !== "ALL") {
    branchFilter = " AND h.pck_cab = ? ";
    params.push(cabang);
  }

  if (status && status !== "ALL") {
    statusFilter = " AND h.pck_status = ? ";
    params.push(status);
  } else {
    statusFilter = " AND h.pck_status NOT IN ('DRAFT', 'SUBMITTED') ";
  }

  const query = `
    SELECT 
        h.pck_idrec AS idrec, 
        h.pck_nomor AS nomor, 
        h.pck_tanggal AS tanggal, 
        h.pck_cab AS cabang,
        g.gdg_nama AS namaCabang,
        h.pck_total AS terpakai,
        
        tf.ptd_nomor AS pck_pth_nomor,
        
        -- [BARU] Ambil Nomor BBK Realisasi dari Finance
        tf.ptd_jur_no AS pck_bbk_finance,

        -- [PERBAIKAN STATUS] Cegah status RECEIVED mundur jadi ON_TRANSFER
        CASE 
            WHEN h.pck_status = 'RECEIVED' THEN 'RECEIVED'
            WHEN tf.ptd_nomor IS NOT NULL THEN 'ON_TRANSFER'
            ELSE h.pck_status 
        END AS status, 
        
        h.pck_keterangan AS keterangan,
        h.pck_acc AS approver,
        h.user_create AS userCreate
    FROM tpettycash_klaim_hdr h
    LEFT JOIN tgudang g ON g.gdg_kode = h.pck_cab
    LEFT JOIN finance.tpengajuan_transfer_dtl tf ON tf.ptd_trs = h.pck_nomor
    
    WHERE DATE(h.pck_tanggal) >= DATE(?) AND DATE(h.pck_tanggal) <= DATE(?) 
    ${branchFilter}
    ${statusFilter}
    ORDER BY h.pck_tanggal DESC, h.pck_nomor DESC`;

  const [rows] = await pool.query(query, params);
  return rows;
};

// --- UNTUK RINCIAN NOTA SAAT DI-EXPAND (KLIK PANAH BAWAH) ---
const getDetailKlaimFinance = async (pck_nomor) => {
  // [OPTIMASI] Menghapus ORDER BY berantai yang berat, diganti dengan
  // sorting standar (tanggal & nomor urut) agar query jauh lebih cepat.
  const query = `
    SELECT 
        h.pc_nomor,
        d.pcd_tanggal,
        d.pcd_pcv,
        d.pcd_kategori,
        d.pcd_keterangan,
        d.pcd_nominal,
        d.pcd_file
    FROM tpettycash_hdr h
    INNER JOIN tpettycash_dtl d ON d.pcd_nomor = h.pc_nomor
    WHERE h.pck_nomor = ?
    ORDER BY d.pcd_tanggal ASC, d.pcd_nourut ASC
  `;
  const [rows] = await pool.query(query, [pck_nomor]);
  return rows;
};
// --- MENGAMBIL DATA UNTUK HALAMAN PROSES & CETAK FINANCE ---
const getKlaimKolektifDetail = async (pck_nomor) => {
  const safeNomor = pck_nomor || "";

  const queryHeader =
    "SELECT h.pck_nomor, h.pck_tanggal, h.pck_cab, h.pck_keterangan, h.pck_total, h.pck_status, h.pck_acc, h.user_create, g.gdg_nama, g.gdg_inv_nama, g.gdg_inv_alamat, g.gdg_inv_kota, g.gdg_inv_telp FROM tpettycash_klaim_hdr h LEFT JOIN tgudang g ON g.gdg_kode = h.pck_cab WHERE h.pck_nomor = ?";

  const [headerRows] = await pool.query(queryHeader, [safeNomor]);

  if (headerRows.length === 0) {
    throw new Error("Data pengajuan tidak ditemukan.");
  }

  const queryDetail =
    "SELECT h.pc_nomor, d.pcd_tanggal, d.pcd_pcv, d.pcd_kategori, d.pcd_keterangan, d.pcd_no_transaksi, d.pcd_nominal, d.pcd_file FROM tpettycash_hdr h INNER JOIN tpettycash_dtl d ON d.pcd_nomor = h.pc_nomor WHERE h.pck_nomor = ? ORDER BY h.pc_nomor ASC, d.pcd_pcv ASC, d.pcd_nourut ASC";

  const [detailRows] = await pool.query(queryDetail, [safeNomor]);

  return { header: headerRows[0], details: detailRows };
};

// --- PROSES APPROVE OLEH FINANCE ---
const approveKlaimKolektif = async (pck_nomor, user, catatan) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const usrKode = user?.kode || "FINANCE";
    const safeNomor = pck_nomor || "";

    // 1. Update Header PCK
    const updatePck =
      "UPDATE tpettycash_klaim_hdr SET pck_status = 'APPROVED', date_approved = NOW(), user_modified = ?, date_modified = NOW() WHERE pck_nomor = ? AND pck_status = 'ACC'";
    const [resPck] = await connection.query(updatePck, [usrKode, safeNomor]);

    if (resPck.affectedRows === 0) {
      throw new Error("Gagal memproses. Dokumen belum di-ACC Supervisor.");
    }

    // 2. Update status semua PC yang terikat
    // [PERBAIKAN]: pc_ket_finance dihapus dari query ini karena kolomnya tidak ada di database
    const updatePc =
      "UPDATE tpettycash_hdr SET pc_status = 'APPROVED', user_modified = ?, date_modified = NOW() WHERE pck_nomor = ?";
    await connection.query(updatePc, [usrKode, safeNomor]);

    await connection.commit();
    return { message: `Pengajuan ${safeNomor} berhasil di-Approve.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const receiveKlaim = async (pck_nomor, payload, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // [PERBAIKAN] Tangkap bbk_finance dari payload
    const { tanggal, nominal, bbk_finance } = payload;
    const safeBbkFinance = bbk_finance || null;

    // 1. Generate Nomor Kas Masuk (Contoh: BKM.K01.2603.0001)
    const yearMonth = format(new Date(tanggal), "yyMM");
    const prefixBkm = `${user.cabang}.BKM.${yearMonth}.`;
    const [nomorRows] = await connection.query(
      `SELECT IFNULL(MAX(RIGHT(mut_nomor_bukti, 4)), 0) + 1 AS next_num FROM tpettycash_mutasi WHERE mut_nomor_bukti LIKE ? FOR UPDATE`,
      [`${prefixBkm}%`],
    );
    const bkm_nomor = `${prefixBkm}${nomorRows[0].next_num.toString().padStart(4, "0")}`;

    // 2. Update status PCK, simpan nomor BKM, dan simpan nomor BBK Finance
    const updatePck = `
      UPDATE tpettycash_klaim_hdr 
      SET pck_status = 'RECEIVED', 
          pck_receive_date = ?, 
          pck_receive_nominal = ?, 
          pck_bkm_nomor = ?, 
          pck_bbk_finance = ?,
          date_received = NOW(), 
          user_modified = ?, 
          date_modified = NOW() 
      WHERE pck_nomor = ? AND pck_status = 'ON_TRANSFER'
    `;
    const [resPck] = await connection.query(updatePck, [
      tanggal,
      nominal,
      bkm_nomor,
      safeBbkFinance, // [BARU]
      user.kode,
      pck_nomor,
    ]);

    if (resPck.affectedRows === 0)
      throw new Error("Gagal. Dokumen belum masuk antrean transfer.");

    // 3. Update status semua PC yang terikat
    await connection.query(
      "UPDATE tpettycash_hdr SET pc_status = 'RECEIVED', user_modified = ?, date_modified = NOW() WHERE pck_nomor = ?",
      [user.kode, pck_nomor],
    );

    // 4. [PENTING] CATAT SEBAGAI DEBET DI BUKU BESAR
    await connection.query(
      `INSERT INTO tpettycash_mutasi (mut_cabang, mut_tanggal, mut_nomor_bukti, mut_tipe, mut_nominal, mut_keterangan) 
       VALUES (?, ?, ?, 'DEBET', ?, ?)`,
      [
        user.cabang,
        tanggal,
        bkm_nomor,
        nominal,
        `Penerimaan Dana untuk Klaim ${pck_nomor}`,
      ],
    );

    await connection.commit();
    return {
      message: `Dana berhasil diterima dengan Nomor Bukti ${bkm_nomor}.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// --- PROSES REJECT OLEH FINANCE ---
const rejectKlaimKolektif = async (pck_nomor, user, alasan) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const usrKode = user?.kode || "FINANCE";
    const safeNomor = pck_nomor || "";
    const safeAlasan = alasan || "Ditolak / Butuh Revisi dari Store";

    // 1. Update Header PCK menjadi REJECTED dan tambahkan alasan ke keterangan
    const updatePck = `
      UPDATE tpettycash_klaim_hdr 
      SET pck_status = 'REJECTED', 
          pck_keterangan = CONCAT(IFNULL(pck_keterangan, ''), '\n[Catatan Revisi Finance]: ', ?),
          user_modified = ?, date_modified = NOW() 
      WHERE pck_nomor = ? AND pck_status = 'ACC'
    `;
    const [resPck] = await connection.query(updatePck, [
      safeAlasan,
      usrKode,
      safeNomor,
    ]);

    if (resPck.affectedRows === 0) {
      throw new Error("Gagal memproses. Dokumen mungkin sudah diproses.");
    }

    // 2. Update status semua PC yang terikat menjadi REJECTED (Agar Store bisa mengeditnya lagi)
    const updatePc = `
      UPDATE tpettycash_hdr 
      SET pc_status = 'REJECTED', user_modified = ?, date_modified = NOW() 
      WHERE pck_nomor = ?
    `;
    await connection.query(updatePc, [usrKode, safeNomor]);

    await connection.commit();
    return {
      message: `Pengajuan ${safeNomor} dikembalikan ke Store untuk direvisi.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// --- PROSES REJECT PER NOTA (SINGLE PC) OLEH FINANCE ---
const rejectSinglePc = async (pck_nomor, pc_nomor, user, alasan) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const usrKode = user?.kode || "FINANCE";
    const safeAlasan = alasan || "Ditolak Finance";

    // 1. Cek nominal nota yang akan ditolak
    const [pcRows] = await connection.query(
      "SELECT pc_total_terpakai FROM tpettycash_hdr WHERE pc_nomor = ? AND pck_nomor = ?",
      [pc_nomor, pck_nomor],
    );

    if (pcRows.length === 0) {
      throw new Error("Nota tidak ditemukan di dalam pengajuan ini.");
    }
    const pcNominal = pcRows[0].pc_total_terpakai;

    // 2. Lepaskan nota dari PCK, ubah status ke REJECTED, dan tempelkan alasan di keterangan
    const updatePc = `
      UPDATE tpettycash_hdr 
      SET pc_status = 'REJECTED', 
          pck_nomor = NULL, 
          pc_ket = CONCAT(IFNULL(pc_ket, ''), '\n[Tolak Finance]: ', ?),
          user_modified = ?, date_modified = NOW()
      WHERE pc_nomor = ?
    `;
    await connection.query(updatePc, [safeAlasan, usrKode, pc_nomor]);

    // 3. Kurangi Total Pengajuan di Header PCK
    await connection.query(
      "UPDATE tpettycash_klaim_hdr SET pck_total = pck_total - ? WHERE pck_nomor = ?",
      [pcNominal, pck_nomor],
    );

    // 4. Jika ternyata ini adalah nota terakhir (semua nota ditolak), otomatis REJECT PCK-nya
    const [checkPck] = await connection.query(
      "SELECT COUNT(*) as count FROM tpettycash_hdr WHERE pck_nomor = ?",
      [pck_nomor],
    );

    if (checkPck[0].count === 0) {
      await connection.query(
        "UPDATE tpettycash_klaim_hdr SET pck_status = 'REJECTED', pck_keterangan = 'Semua nota ditolak Finance' WHERE pck_nomor = ?",
        [pck_nomor],
      );
    }

    await connection.commit();
    return { message: `Nota ${pc_nomor} dikembalikan ke Store.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// --- PROSES TANDAI TRANSFER OLEH FINANCE ---
const transferKlaimKolektif = async (pck_nomor, pth_nomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const usrKode = user?.kode || "FINANCE";
    const safeNomor = pck_nomor || "";
    const safePthNomor = pth_nomor || null; // Bisa null kalau finance lupa isi, tapi sebaiknya di frontend di-set wajib (required)

    // 1. Update Header PCK menjadi ON_TRANSFER dan simpan nomor PJT-nya
    const updatePck = `
      UPDATE tpettycash_klaim_hdr 
      SET pck_status = 'ON_TRANSFER', 
          pck_pth_nomor = ?, 
          date_transfer = NOW(), 
          user_modified = ?, 
          date_modified = NOW() 
      WHERE pck_nomor = ? AND pck_status = 'APPROVED'
    `;
    const [resPck] = await connection.query(updatePck, [
      safePthNomor,
      usrKode,
      safeNomor,
    ]);

    if (resPck.affectedRows === 0) {
      throw new Error(
        "Gagal memproses. Dokumen mungkin belum di-Approve atau sudah diproses.",
      );
    }

    // 2. Update status semua PC child yang terikat
    const updatePc = `
      UPDATE tpettycash_hdr 
      SET pc_status = 'ON_TRANSFER', user_modified = ?, date_modified = NOW() 
      WHERE pck_nomor = ?
    `;
    await connection.query(updatePc, [usrKode, safeNomor]);

    await connection.commit();
    return {
      message: `Pengajuan ${safeNomor} berhasil ditandai masuk proses transfer dengan referensi ${safePthNomor}.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const deleteData = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Cek keberadaan dan status dokumen
    const [rows] = await connection.query(
      "SELECT pc_status, pc_cab FROM tpettycash_hdr WHERE pc_nomor = ?",
      [nomor],
    );

    if (rows.length === 0) {
      throw new Error("Data Petty Cash tidak ditemukan.");
    }

    const pc = rows[0];

    // 2. Proteksi Status (Hanya DRAFT yang boleh dihapus)
    if (pc.pc_status !== "DRAFT") {
      throw new Error(
        "Gagal! Hanya dokumen berstatus DRAFT yang dapat dihapus.",
      );
    }

    // 3. Proteksi Cabang (User hanya boleh hapus data cabangnya sendiri, kecuali KDC/Pusat)
    if (pc.pc_cab !== user.cabang && user.cabang !== "KDC") {
      throw new Error(
        "Anda tidak memiliki akses untuk menghapus data cabang lain.",
      );
    }

    // =========================================================================
    // 4. MENGEMBALIKAN SALDO (HAPUS MUTASI KAS)
    // Menghapus data pengeluaran di tabel mutasi. Begitu baris KREDIT ini dihapus,
    // maka saldo toko akan otomatis kembali utuh seperti semula!
    // =========================================================================
    await connection.query(
      "DELETE FROM tpettycash_mutasi WHERE mut_nomor_bukti = ?",
      [nomor],
    );

    // 5. Hapus Detail Nota
    await connection.query("DELETE FROM tpettycash_dtl WHERE pcd_nomor = ?", [
      nomor,
    ]);

    // 6. Hapus Header Petty Cash
    await connection.query("DELETE FROM tpettycash_hdr WHERE pc_nomor = ?", [
      nomor,
    ]);

    await connection.commit();
    return {
      message: `Laporan Petty Cash ${nomor} berhasil dihapus dan saldo telah dikembalikan.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  getList,
  submitData, // Jangan lupa di-export
  submitKlaimKolektif,
  getDraftsForKlaim,
  accKlaim,
  getListKlaimFinance,
  getDetailKlaimFinance,
  getKlaimKolektifDetail,
  approveKlaimKolektif,
  receiveKlaim,
  rejectKlaimKolektif,
  rejectSinglePc,
  transferKlaimKolektif,
  deleteData,
};
