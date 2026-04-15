const pool = require("../config/database");
const { format } = require("date-fns");
const fcmService = require("../services/fcmService");

// Helper untuk generate Nomor Urut yang PASTI UNIK
const generateAuthNumber = async (cabang) => {
  // Ganti pakai format yyyyMMddHHmmssSSS biar anti-bentrok walau diklik dobel!
  const timestamp = format(new Date(), "yyyyMMddHHmmssSSS");
  const random = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, "0");

  return `${cabang}.AUTH.${timestamp}${random}`;
};

const authPinService = {
  async createRequest(payload) {
    // 1. Destructure Payload
    const {
      transaksi,
      jenis,
      keterangan,
      nominal,
      cabang,
      user,
      barcode,
      target_cabang,
    } = payload;

    // 2. Generate Nomor & Insert DB
    const authNomor = await generateAuthNumber(cabang);
    const query = `
            INSERT INTO totorisasi 
            (o_nomor, o_transaksi, o_jenis, o_ket, o_nominal, o_cab, o_status, o_requester, o_created, o_pin, o_barcode, o_target)
            VALUES (?, ?, ?, ?, ?, ?, 'P', ?, NOW(), '-', ?, ?)
        `;

    await pool.query(query, [
      authNomor,
      transaksi || "NEW_TRX",
      jenis,
      keterangan,
      nominal || 0,
      cabang,
      user,
      barcode || "",
      target_cabang || null,
    ]);

    // ------------------------------------------------------------------
    // 3. LOGIKA NOTIFIKASI (FIXED)
    // ------------------------------------------------------------------
    try {
      const title = `Permintaan Otorisasi: ${jenis.replace(/_/g, " ")}`;
      // Body notifikasi disesuaikan agar jelas untuk penerima
      const body = `Req: ${user} (Dari: ${cabang})\nKet: ${
        keterangan.split("\n")[0]
      }`;

      const dataPayload = {
        jenis: String(jenis),
        nominal: String(nominal),
        transaksi: String(transaksi || ""),
        authId: String(authNomor),
      };

      if (String(jenis).trim() === "TRANSFER_SOP") {
        // Sesuai permintaan: Kirim hanya ke RIO untuk Transfer SOP
        managerCodes = ["RIO"];
      } else if (
        String(jenis).trim() === "AMBIL_BARANG" &&
        target_cabang &&
        target_cabang !== "KDC"
      ) {
        // Jalur Toko (seperti Ambil Barang antar Toko)
        const targetTopic = `approval_${target_cabang}`;
        await fcmService.sendToTopic(targetTopic, title, body, dataPayload);
      } else {
        // --- ALUR 2: KIRIM KE MANAGER (HARIS/DARUL) ---

        const today = new Date();
        const isEstuManagerPeriod =
          today >= new Date(2026, 0, 12) && today < new Date(2026, 0, 17);
        const isPeminjaman = String(jenis).trim() === "PEMINJAMAN_BARANG";
        const isKlaimPettyCash = String(jenis).trim() === "KLAIM_PETTYCASH";
        const isSubmitBap = String(jenis).trim() === "SUBMIT_BAP";

        let managerCodes = ["DARUL"]; // Darul selalu dikirim

        if (isPeminjaman || isKlaimPettyCash || isSubmitBap) {
          if (!managerCodes.includes("ESTU")) managerCodes.push("ESTU");
        }

        if (isEstuManagerPeriod) {
          // Periode 12-16 Jan: Transaksi Manager lari ke ESTU
          if (!managerCodes.includes("ESTU")) managerCodes.push("ESTU");
        } else {
          // Periode Normal: Transaksi Manager lari ke HARIS
          // [PERBAIKAN] Haris TIDAK dikirimi notif jika jenisnya Peminjaman / Petty Cash (karena itu milik Estu)
          if (!isPeminjaman && !isKlaimPettyCash && !isSubmitBap) {
            managerCodes.push("HARIS");
          }
        }

        const [managers] = await pool.query(
          `SELECT DISTINCT user_fcm_token FROM tuser 
           WHERE user_kode IN (?) 
           AND user_fcm_token IS NOT NULL AND user_fcm_token != ''`,
          [managerCodes],
        );

        if (managers.length > 0) {
          const sendPromises = managers.map((mgr) =>
            fcmService.sendNotification(
              mgr.user_fcm_token,
              title,
              body,
              dataPayload,
            ),
          );
          await Promise.all(sendPromises);
        }
      }
    } catch (fcmError) {
      console.error("[FCM] Gagal mengirim notifikasi (Ignored):", fcmError);
    }

    return {
      success: true,
      message: "Permintaan otorisasi terkirim.",
      authNomor: authNomor,
    };
  },

  async checkStatus(authNomor) {
    const query = `SELECT o_status, o_approver FROM totorisasi WHERE o_nomor = ?`;
    const [rows] = await pool.query(query, [authNomor]);

    if (rows.length === 0) {
      return { status: "NOT_FOUND", isApproved: false };
    }

    const data = rows[0];
    let statusText = "PENDING";
    let isApproved = false;

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

  async getPendingRequests(userCabang, userKode) {
    const userKodeUpper = String(userKode).toUpperCase();
    const today = new Date();
    const isEstuManagerPeriod =
      today >= new Date(2026, 0, 12) && today < new Date(2026, 0, 17);

    let query = "SELECT * FROM totorisasi WHERE o_status = 'P' ";
    const params = [];

    if (userCabang === "KDC") {
      if (userKodeUpper === "ESTU") {
        if (isEstuManagerPeriod) {
          query +=
            " AND (o_target IS NULL OR o_target = 'KDC' OR o_target = '' OR o_jenis IN ('PEMINJAMAN_BARANG', 'KLAIM_PETTYCASH', 'SUBMIT_BAP')) ";
        } else {
          query +=
            " AND o_jenis IN ('PEMINJAMAN_BARANG', 'KLAIM_PETTYCASH', 'SUBMIT_BAP') ";
        }
      } else if (userKodeUpper === "HARIS") {
        if (isEstuManagerPeriod) {
          query += " AND 1=0 "; // Kosongkan list
        } else {
          query +=
            " AND (o_target IS NULL OR o_target = 'KDC' OR o_target = '') AND o_jenis NOT IN ('PEMINJAMAN_BARANG', 'KLAIM_PETTYCASH', 'SUBMIT_BAP') ";
        }
      } else if (userKodeUpper === "RIO") {
        query += " AND o_jenis = 'TRANSFER_SOP' ";
      } else {
        query +=
          " AND (o_target IS NULL OR o_target = 'KDC' OR o_target = '' OR o_jenis IN ('PEMINJAMAN_BARANG', 'KLAIM_PETTYCASH', 'SUBMIT_BAP')) ";
      }
    } else {
      query +=
        " AND (o_target = ? OR (o_cab = ? AND (o_target IS NULL OR o_target = ''))) ";
      params.push(userCabang, userCabang);
    }

    query += " ORDER BY o_created DESC";
    const [rows] = await pool.query(query, params);
    return rows;
  },

  async processRequest(authNomor, managerUser, action) {
    const newStatus = action === "APPROVE" ? "Y" : "N";

    const query = `
            UPDATE totorisasi 
            SET 
                o_status = ?, 
                o_approver = ?, 
                o_approved_at = NOW()
            WHERE o_nomor = ? AND o_status = 'P'
        `;

    const [result] = await pool.query(query, [
      newStatus,
      managerUser,
      authNomor,
    ]);

    if (result.affectedRows === 0) {
      throw new Error(
        "Gagal memproses. Request mungkin sudah diproses atau tidak ditemukan.",
      );
    }

    return { success: true, message: `Otorisasi berhasil di-${action}` };
  },
};

module.exports = authPinService;
