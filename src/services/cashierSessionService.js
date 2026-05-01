const pool = require("../config/database");
const { format } = require("date-fns");

// Helper untuk memvalidasi PIN User
const validatePin = async (connection, userKode, pin) => {
  // Sesuaikan nama kolom "user_password" atau "user_pin" dengan tabel tuser Mas Rizal
  const [rows] = await connection.query(
    "SELECT user_kode FROM tuser WHERE user_kode = ? AND user_password = ?",
    [userKode, pin],
  );
  if (rows.length === 0) {
    throw new Error(`PIN untuk user ${userKode} tidak valid.`);
  }
  return true;
};

// Helper Generate ID Sesi: K01-SESI-260427001
const generateSesiId = async (connection, cabang) => {
  const datePrefix = format(new Date(), "yyMMdd");
  const prefix = `${cabang}-SESI-${datePrefix}`;

  const [rows] = await connection.query(
    `SELECT IFNULL(MAX(CAST(RIGHT(sesi_id, 3) AS UNSIGNED)), 0) AS maxNum 
     FROM tkasir_sesi WHERE sesi_id LIKE CONCAT(?, '%')`,
    [prefix],
  );
  const nextNum = parseInt(rows[0].maxNum, 10) + 1;
  return `${prefix}${String(nextNum).padStart(3, "0")}`;
};

// 1. Dapatkan Sesi Aktif di Cabang
const getCurrentSession = async (cabang) => {
  const query = `
    SELECT * FROM tkasir_sesi 
    WHERE cabang = ? AND status IN ('OPEN', 'PAUSED') 
    ORDER BY waktu_buka DESC LIMIT 1
  `;
  const [rows] = await pool.query(query, [cabang]);

  if (rows.length === 0) return null;
  const session = rows[0];

  // Jika sedang dipause, cari tahu siapa yang lagi jaga
  if (session.status === "PAUSED") {
    const [logRows] = await pool.query(
      `SELECT * FROM tkasir_istirahat 
       WHERE sesi_id = ? AND status = 'ACTIVE' ORDER BY waktu_mulai DESC LIMIT 1`,
      [session.sesi_id],
    );
    session.active_pengganti =
      logRows.length > 0 ? logRows[0].kasir_pengganti : null;
  }

  // =========================================================================
  // [PERBAIKAN KUNCI] MENGHITUNG SALDO SISTEM SECARA REAL-TIME
  // =========================================================================
  const sesiId = session.sesi_id;
  const modalAwal = Number(session.modal_awal) || 0;

  // 1. UANG MASUK (Semua Tunai: Invoice Baru, DP, Pelunasan Piutang)
  const [setorRows] = await pool.query(
    "SELECT SUM(sh_nominal) as total_tunai FROM tsetor_hdr WHERE sh_sesi_id = ? AND sh_jenis = 0",
    [sesiId],
  );
  const tunaiMasuk = Number(setorRows[0].total_tunai) || 0;

  // [HAPUS] Tarikan uang keluar Petty Cash karena PC punya modul & dompet sendiri

  // Timpa nilai 0 dari database dengan hasil hitungan real-time
  session.saldo_sistem = modalAwal + tunaiMasuk;
  // =========================================================================

  return session;
};

// 2. BUKA SHIFT (Mulai Sesi)
const startSession = async (cabang, kasirUtama, modalAwal) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    // Cek apakah ada sesi yang masih menggantung
    const activeSession = await getCurrentSession(cabang);
    if (activeSession) {
      throw new Error(
        `Masih ada sesi kasir yang aktif (${activeSession.sesi_id}). Tutup shift sebelumnya terlebih dahulu.`,
      );
    }

    const sesiId = await generateSesiId(connection, cabang);

    await connection.query(
      `INSERT INTO tkasir_sesi 
       (sesi_id, cabang, kasir_utama, waktu_buka, modal_awal, status, user_create, date_create) 
       VALUES (?, ?, ?, NOW(), ?, 'OPEN', ?, NOW())`,
      [sesiId, cabang, kasirUtama, modalAwal, kasirUtama],
    );

    await connection.commit();
    return { sesi_id: sesiId, status: "OPEN", modal_awal: modalAwal };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// 3. ISTIRAHAT (Pause Sesi & Serah Terima Sementara)
const pauseSession = async (
  sesiId,
  kasirUtama,
  kasirPengganti,
  pinPengganti,
  keterangan,
) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    // Cek Sesi
    const [sesiRows] = await connection.query(
      "SELECT status, kasir_utama FROM tkasir_sesi WHERE sesi_id = ? FOR UPDATE",
      [sesiId],
    );
    if (sesiRows.length === 0) throw new Error("Sesi tidak ditemukan.");
    if (sesiRows[0].status !== "OPEN")
      throw new Error("Sesi tidak dalam status OPEN.");
    if (sesiRows[0].kasir_utama !== kasirUtama)
      throw new Error(
        "Hanya kasir utama yang bisa melakukan serah terima sementara.",
      );

    // Validasi PIN Kasir Pengganti
    await validatePin(connection, kasirPengganti, pinPengganti);

    // Update Status Sesi Utama
    await connection.query(
      "UPDATE tkasir_sesi SET status = 'PAUSED' WHERE sesi_id = ?",
      [sesiId],
    );

    // Insert Log Istirahat
    await connection.query(
      `INSERT INTO tkasir_istirahat (sesi_id, kasir_pengganti, waktu_mulai, keterangan, status) 
       VALUES (?, ?, NOW(), ?, 'ACTIVE')`,
      [sesiId, kasirPengganti, keterangan],
    );

    await connection.commit();
    return {
      message: `Sesi dipause. Laci kini dipegang oleh ${kasirPengganti}.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// 4. KEMBALI ISTIRAHAT (Resume Sesi)
const resumeSession = async (sesiId, kasirUtama, pinUtama) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    const [sesiRows] = await connection.query(
      "SELECT status, kasir_utama FROM tkasir_sesi WHERE sesi_id = ? FOR UPDATE",
      [sesiId],
    );
    if (sesiRows.length === 0) throw new Error("Sesi tidak ditemukan.");
    if (sesiRows[0].status !== "PAUSED")
      throw new Error("Sesi sedang tidak di-pause.");

    // Validasi PIN Kasir Utama
    await validatePin(connection, kasirUtama, pinUtama);

    // Selesaikan Log Istirahat
    await connection.query(
      `UPDATE tkasir_istirahat SET waktu_selesai = NOW(), status = 'DONE' 
       WHERE sesi_id = ? AND status = 'ACTIVE'`,
      [sesiId],
    );

    // Kembalikan Sesi ke OPEN
    await connection.query(
      "UPDATE tkasir_sesi SET status = 'OPEN' WHERE sesi_id = ?",
      [sesiId],
    );

    await connection.commit();
    return { message: "Sesi kembali dilanjutkan oleh Kasir Utama." };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// 5. TUTUP SHIFT (End Sesi Permanen)
const endSession = async (
  sesiId,
  kasirUtama,
  kasirPenerima,
  pinPenerima,
  saldoFisikDariLayar,
  keteranganSelisih,
) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    const [sesiRows] = await connection.query(
      "SELECT * FROM tkasir_sesi WHERE sesi_id = ? FOR UPDATE",
      [sesiId],
    );
    if (sesiRows.length === 0) throw new Error("Sesi tidak ditemukan.");
    if (sesiRows[0].status === "CLOSED")
      throw new Error("Sesi sudah ditutup sebelumnya.");

    // Validasi PIN Otomatis Cerdas
    if (kasirPenerima === "TUTUP_TOKO") {
      await validatePin(connection, kasirUtama, pinPenerima);
    } else {
      await validatePin(connection, kasirPenerima, pinPenerima);
    }

    // =========================================================================
    // 🧮 MENGHITUNG SALDO SISTEM (HANYA UANG TUNAI DI LACI KASIR)
    // =========================================================================
    const modalAwal = Number(sesiRows[0].modal_awal) || 0;

    // 1. UANG MASUK (Semua Tunai dari Invoice, DP, & Piutang yang direkam di TSetor)
    const [setorRows] = await connection.query(
      "SELECT SUM(sh_nominal) as total_tunai FROM tsetor_hdr WHERE sh_sesi_id = ? AND sh_jenis = 0",
      [sesiId],
    );
    const tunaiMasuk = Number(setorRows[0].total_tunai) || 0;

    // [HAPUS] Tarikan uang keluar Petty Cash karena PC punya modul & dompet sendiri

    // RUMUS FINAL SALDO SISTEM KASIR
    const saldoSistemReal = modalAwal + tunaiMasuk;
    // =========================================================================

    const saldoFisik = Number(saldoFisikDariLayar) || 0;
    const selisih = saldoFisik - saldoSistemReal;

    // Jika ada selisih wajib isi keterangan
    if (
      selisih !== 0 &&
      (!keteranganSelisih || keteranganSelisih.trim() === "")
    ) {
      throw new Error(
        `Terdapat selisih kas sebesar Rp ${selisih}! Keterangan wajib diisi.`,
      );
    }

    // Update data penutupan
    const query = `
      UPDATE tkasir_sesi SET 
        waktu_tutup = NOW(), 
        saldo_sistem = ?, 
        saldo_fisik = ?, 
        selisih = ?, 
        keterangan_selisih = ?, 
        status = 'CLOSED', 
        kasir_penerima = ?,
        user_modified = ?,
        date_modified = NOW()
      WHERE sesi_id = ?
    `;
    await connection.query(query, [
      saldoSistemReal,
      saldoFisik,
      selisih,
      keteranganSelisih,
      kasirPenerima,
      kasirUtama,
      sesiId,
    ]);

    await connection.commit();
    return {
      message: `Shift ditutup. Laci diserahkan ke ${kasirPenerima}.`,
      selisih,
      saldo_sistem: saldoSistemReal,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  getCurrentSession,
  startSession,
  pauseSession,
  resumeSession,
  endSession,
};
