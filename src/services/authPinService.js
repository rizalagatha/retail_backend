const pool = require("../config/database");
const { format } = require("date-fns");
const fcmService = require("../services/fcmService");

// Helper untuk generate Nomor Urut: CAB.AUTH.YYMM.0001
const generateAuthNumber = async (cabang) => {
  const date = new Date();
  const yyMM = format(date, "yyMM"); // Contoh: 2512 (Des 2025)

  // Format Prefix: K06.AUTH.2512.
  const prefix = `${cabang}.AUTH.${yyMM}.`;

  // Cari nomor terakhir di database berdasarkan prefix bulan ini
  const query = `
        SELECT o_nomor 
        FROM totorisasi 
        WHERE o_nomor LIKE ? 
        ORDER BY o_nomor DESC 
        LIMIT 1
    `;

  const [rows] = await pool.query(query, [`${prefix}%`]);

  let sequence = 1;

  if (rows.length > 0) {
    // Jika ada data (misal: K06.AUTH.2512.0005)
    const lastNomor = rows[0].o_nomor;
    const lastSeqString = lastNomor.split(".").pop(); // Ambil 0005
    const lastSeq = parseInt(lastSeqString, 10);

    if (!isNaN(lastSeq)) {
      sequence = lastSeq + 1;
    }
  }

  // Pad dengan 0 di depan (misal: 1 -> 0001)
  const formattedSeq = sequence.toString().padStart(4, "0");

  return `${prefix}${formattedSeq}`;
};

const authPinService = {
  async createRequest(payload) {
    // [UPDATE] Tambahkan barcode dari payload
    const { transaksi, jenis, keterangan, nominal, cabang, user, barcode } =
      payload;

    const authNomor = await generateAuthNumber(cabang);

    // [UPDATE] Tambahkan o_barcode pada INSERT
    const query = `
            INSERT INTO totorisasi 
            (o_nomor, o_transaksi, o_jenis, o_ket, o_nominal, o_cab, o_status, o_requester, o_created, o_pin, o_barcode)
            VALUES (?, ?, ?, ?, ?, ?, 'P', ?, NOW(), '-', ?)
        `;

    await pool.query(query, [
      authNomor,
      transaksi || "NEW_TRX",
      jenis,
      keterangan,
      nominal || 0,
      cabang,
      user,
      barcode || "", // Simpan barcode (default string kosong)
    ]);

    // ------------------------------------------------------------------
    // [BARU] LOGIKA KIRIM NOTIFIKASI KE MANAGER (FIREBASE)
    // ------------------------------------------------------------------
    try {
      // A. Cari Token HP Manager dari tabel tuser
      // Logic: Ambil user dengan level MANAGER.
      // Jika ingin spesifik cabang, tambahkan: AND user_cabang = ? (isi dengan cabang)
      // Disini saya buat agar semua MANAGER menerima notif (atau sesuaikan kebutuhan)
      const [managers] = await pool.query(
        `SELECT DISTINCT user_fcm_token FROM tuser 
          WHERE user_kode IN ('HARIS', 'DARUL') 
          AND user_fcm_token IS NOT NULL 
          AND user_fcm_token != ''`
      );

      if (managers.length > 0) {
        console.log(
          `[FCM] Mengirim notif ke ${managers.length} orang (HARIS/DARUL).`
        );

        const title = `Permintaan Otorisasi: ${jenis.replace(/_/g, " ")}`;
        const body = `Req: ${user} (Cab: ${cabang})\nNominal: Rp ${Number(
          nominal
        ).toLocaleString("id-ID")}\n${keterangan.split("\n")[0]}`;

        // Payload Data (untuk dibuka di HP)
        const dataPayload = {
          jenis: String(jenis),
          nominal: String(nominal),
          transaksi: String(transaksi || ""),
          keterangan: String(keterangan || ""),
        };

        // B. Loop & Kirim
        // Kita gunakan Promise.all agar tidak memblokir response terlalu lama
        const sendPromises = managers.map((mgr) =>
          fcmService.sendNotification(
            mgr.user_fcm_token,
            title,
            body,
            dataPayload
          )
        );

        // Jalankan background (jangan await jika ingin response API cepat,
        // tapi await lebih aman untuk debugging awal)
        await Promise.all(sendPromises);
      }
    } catch (fcmError) {
      // Jangan biarkan error notifikasi menggagalkan transaksi utama
      console.error("[FCM] Gagal mengirim notifikasi (Ignored):", fcmError);
    }
    // ------------------------------------------------------------------

    return {
      success: true,
      message: "Permintaan otorisasi terkirim ke Manager.",
      authNomor: authNomor,
    };
  },

  async checkStatus(authNomor) {
    const query = `SELECT o_status, o_approver FROM totorisasi WHERE o_nomor = ?`;
    const [rows] = await pool.query(query, [authNomor]);

    if (rows.length === 0) {
      // Opsional: return status NOT_FOUND atau error
      return { status: "NOT_FOUND", isApproved: false };
    }

    const data = rows[0];

    let statusText = "PENDING";
    let isApproved = false;

    // [FIX] Cek menggunakan String 'Y' dan 'N' (bukan angka 1 atau 2)
    if (data.o_status === "Y") {
      statusText = "APPROVED";
      isApproved = true;
    } else if (data.o_status === "N") {
      statusText = "REJECTED";
      isApproved = false;
    }

    return {
      status: statusText,
      isApproved: isApproved,
      approver: data.o_approver,
    };
  },

  async getPendingRequests(cabang) {
    // [UBAH] Filter WHERE o_status = 'P'
    let query = `SELECT * FROM totorisasi WHERE o_status = 'P' `;
    const params = [];

    if (cabang !== "KDC") {
      query += `AND o_cab = ? `;
      params.push(cabang);
    }

    query += `ORDER BY o_created DESC`;

    const [rows] = await pool.query(query, params);
    return rows;
  },

  async processRequest(authNomor, managerUser, action) {
    // [UBAH] Mapping Action ke Huruf
    // APPROVE -> 'Y'
    // REJECT  -> 'N'
    const newStatus = action === "APPROVE" ? "Y" : "N";

    const query = `
            UPDATE totorisasi 
            SET 
                o_status = ?, 
                o_approver = ?, 
                o_approved_at = NOW()
            WHERE o_nomor = ? AND o_status = 'P'  -- Pastikan hanya update yang masih 'P'
        `;

    const [result] = await pool.query(query, [
      newStatus,
      managerUser,
      authNomor,
    ]);

    if (result.affectedRows === 0) {
      throw new Error(
        "Gagal memproses. Request mungkin sudah diproses atau tidak ditemukan."
      );
    }

    return { success: true, message: `Otorisasi berhasil di-${action}` };
  },
};

module.exports = authPinService;
