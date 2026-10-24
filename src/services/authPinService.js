const pool = require("../config/database");
const { format } = require("date-fns");
const fcmService = require("../services/fcmService");

// Helper untuk generate Nomor Urut yang PASTI UNIK
const generateAuthNumber = async (cabang) => {
  const date = new Date();
  const yyMM = format(date, "yyMM");
  const prefix = `${cabang}.AUTH.${yyMM}.`;

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
    const lastNomor = rows[0].o_nomor;
    const lastSeqString = lastNomor.split(".").pop();
    const lastSeq = parseInt(lastSeqString, 10);
    if (!isNaN(lastSeq)) sequence = lastSeq + 1;
  }

  const formattedSeq = sequence.toString().padStart(4, "0");
  return `${prefix}${formattedSeq}`; // Hasilnya pas 18 karakter: K01.AUTH.2604.0001
};

// Tindak lanjut ACC/tolak mutasi kirim. Stok sudah terpotong saat simpan (trigger tmsk_dtl),
// jadi ACC hanya membuka gerbang cetak/terima. Tolak = hapus dokumen (trigger before_delete
// mengembalikan stok) dan unit serial dikembalikan ke toko pengirim.
const prosesAccMutasiKirim = async (nomor, action, approver) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [hdr] = await connection.query(
      "SELECT msk_cab, msk_status_acc FROM tmsk_hdr WHERE msk_nomor = ? FOR UPDATE",
      [nomor],
    );
    // Dokumen sudah tidak ada atau sudah diproses: tidak ada yang dikerjakan
    if (hdr.length === 0 || hdr[0].msk_status_acc !== "MENUNGGU") {
      await connection.rollback();
      return;
    }

    if (action === "APPROVE") {
      await connection.query(
        "UPDATE tmsk_hdr SET msk_status_acc = 'ACC' WHERE msk_nomor = ?",
        [nomor],
      );
    } else {
      const [serials] = await connection.query(
        "SELECT mskd_unit_serial FROM tmsk_dtl WHERE mskd_nomor = ? AND mskd_unit_serial IS NOT NULL",
        [nomor],
      );
      if (serials.length > 0) {
        await connection.query(
          `UPDATE tbarangdc_unit
           SET unit_status = 'DI_TOKO', unit_lokasi_saat_ini = ?, date_modified = NOW(), user_modified = ?
           WHERE unit_serial IN (?)`,
          [hdr[0].msk_cab, approver, serials.map((r) => r.mskd_unit_serial)],
        );
      }
      await connection.query("DELETE FROM tmsk_dtl WHERE mskd_nomor = ?", [
        nomor,
      ]);
      await connection.query("DELETE FROM tmsk_hdr WHERE msk_nomor = ?", [
        nomor,
      ]);
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// ACC/tolak refund oleh SPV. Satu UPDATE sudah cukup: posting uang tetap oleh finance sesudahnya.
const prosesAccRefund = async (nomor, action) => {
  await pool.query(
    "UPDATE trefund_hdr SET rf_status_acc = ? WHERE rf_nomor = ? AND rf_status_acc = 'MENUNGGU'",
    [action === "APPROVE" ? "ACC" : "DITOLAK", nomor],
  );
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
        await fcmService.sendToTopic("user_RIO", title, body, dataPayload);
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
        // Jenis yang diproses Estu (bukan Haris), selain Darul
        const jenisEstu = [
          "PEMINJAMAN_BARANG",
          "KLAIM_PETTYCASH",
          "SUBMIT_BAP",
          "CLOSE_PENAWARAN",
          "CLOSE_SO_DTF",
          "CLOSE_SO",
          "CLOSE_PH",
          "MUTASI_KIRIM",
          "REFUND",
        ];
        const isJenisEstu = jenisEstu.includes(String(jenis).trim());

        let managerCodes;
        if (String(jenis).trim() === "REFUND") {
          managerCodes = ["ESTU"]; // Refund hanya ke SPV (Estu)
        } else {
          managerCodes = ["DARUL"]; // Darul selalu dikirim
          if (isJenisEstu || isEstuManagerPeriod) {
            managerCodes.push("ESTU");
          } else {
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

    const managerTypes = [
      "PEMINJAMAN_BARANG",
      "KLAIM_PETTYCASH",
      "SUBMIT_BAP",
      "TRANSFER_SOP",
      "DISKON_FAKTUR",
      "SO_TANPA_DP",
      "SO_DTF_TANPA_DP",
      "BELUM_LUNAS",
      "DISKON_ITEM",
      "PIUTANG",
      "CLOSE_PENAWARAN",
      "CLOSE_SO_DTF",
      "CLOSE_SO",
      "CLOSE_PH",
      "MUTASI_KIRIM",
      "REFUND",
    ];

    if (userCabang === "KDC") {
      if (userKodeUpper === "ESTU") {
        if (isEstuManagerPeriod) {
          query +=
            " AND (o_target IS NULL OR o_target = 'KDC' OR o_target = '' OR o_jenis IN (?)) ";
        } else {
          query += " AND o_jenis IN (?) ";
        }
        params.push([
          "PEMINJAMAN_BARANG",
          "KLAIM_PETTYCASH",
          "SUBMIT_BAP",
          "CLOSE_PENAWARAN",
          "CLOSE_SO_DTF",
          "CLOSE_SO",
          "CLOSE_PH",
          "MUTASI_KIRIM",
          "REFUND",
        ]);
      } else if (userKodeUpper === "HARIS") {
        if (isEstuManagerPeriod) {
          query += " AND 1=0 ";
        } else {
          query +=
            " AND (o_target IS NULL OR o_target = 'KDC' OR o_target = '') AND o_jenis NOT IN (?) ";
          params.push([
            "PEMINJAMAN_BARANG",
            "KLAIM_PETTYCASH",
            "SUBMIT_BAP",
            "TRANSFER_SOP",
            "MUTASI_KIRIM",
            "REFUND",
          ]);
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

      // ================================================================================
      // [PERBAIKAN KUNCI]: BLOKIR JENIS TRANSAKSI LEVEL MANAGER AGAR TIDAK TAMPIL DI TOKO!
      // ================================================================================
      query += " AND o_jenis NOT IN (?) ";

      params.push(userCabang, userCabang, managerTypes);
    }

    query += " ORDER BY o_created DESC";
    const [rows] = await pool.query(query, params);
    return rows;
  },

  async processRequest(authNomor, managerUser, action) {
    const newStatus = action === "APPROVE" ? "Y" : "N";

    const [authDataCheck] = await pool.query(
      "SELECT o_jenis, o_cab, o_requester FROM totorisasi WHERE o_nomor = ?",
      [authNomor],
    );
    if (authDataCheck.length === 0) {
      throw new Error("Data otorisasi tidak ditemukan.");
    }

    const { o_jenis, o_cab, o_requester } = authDataCheck[0];

    // Siapa yang sah meng-ACC tiap jenis, dan pemohon tidak boleh meng-ACC miliknya sendiri
    const aturanApprover = {
      MUTASI_KIRIM: ["DARUL", "ESTU"],
      REFUND: ["ESTU"],
    };
    const approverSah = aturanApprover[o_jenis];
    if (approverSah) {
      const kodeUpper = String(managerUser).toUpperCase();
      if (!approverSah.includes(kodeUpper)) {
        throw new Error(
          `Otorisasi ${o_jenis.replace(/_/g, " ")} hanya boleh dilakukan oleh ${approverSah.join(" atau ")}.`,
        );
      }
      if (String(o_requester).toUpperCase() === kodeUpper) {
        throw new Error("Tidak boleh meng-ACC permintaan sendiri.");
      }
    }

    const query = `
      UPDATE totorisasi 
      SET o_status = ?, o_approver = ?, o_approved_at = NOW()
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

    // =========================================================================
    // [BARU] HOOK UNTUK MENG-ACC PETTY CASH SECARA OTOMATIS (WEB VERSION)
    // =========================================================================
    const [authData] = await pool.query(
      "SELECT o_transaksi, o_jenis FROM totorisasi WHERE o_nomor = ?",
      [authNomor],
    );

    if (authData.length > 0) {
      const { o_transaksi, o_jenis } = authData[0];

      if (o_jenis === "KLAIM_PETTYCASH" && o_transaksi) {
        if (action === "APPROVE") {
          await pool.query(
            `UPDATE tpettycash_klaim_hdr SET pck_status = 'ACC', pck_acc = ?, date_acc = NOW(), user_modified = ?, date_modified = NOW() WHERE pck_nomor = ? AND pck_status = 'SUBMITTED'`,
            [managerUser, managerUser, o_transaksi],
          );
          await pool.query(
            `UPDATE tpettycash_hdr SET pc_status = 'ACC', user_modified = ?, date_modified = NOW() WHERE pck_nomor = ?`,
            [managerUser, o_transaksi],
          );
        } else if (action === "REJECT") {
          const alasan = "Ditolak via Web Otorisasi";

          await pool.query(
            `UPDATE tpettycash_klaim_hdr SET pck_status = 'REJECTED', pck_keterangan = CONCAT(IFNULL(pck_keterangan, ''), '\n[Catatan Revisi]: ', ?), user_modified = ?, date_modified = NOW() WHERE pck_nomor = ? AND pck_status = 'SUBMITTED'`,
            [alasan, managerUser, o_transaksi],
          );

          // [PERBAIKAN KUNCI]: Lepaskan ikatan pck_nomor
          await pool.query(
            `UPDATE tpettycash_hdr SET pc_status = 'REJECTED', pck_nomor = NULL, user_modified = ?, date_modified = NOW() WHERE pck_nomor = ?`,
            [managerUser, o_transaksi],
          );
        }
      }
    }
    if ((o_jenis === "MUTASI_KIRIM" || o_jenis === "REFUND") && o_transaksi) {
      try {
        if (o_jenis === "MUTASI_KIRIM") {
          await prosesAccMutasiKirim(o_transaksi, action, managerUser);
        } else {
          await prosesAccRefund(o_transaksi, action);
        }
      } catch (hookError) {
        // Kembalikan ke pending supaya bisa diproses ulang, jangan menggantung Y/N
        await pool.query(
          "UPDATE totorisasi SET o_status = 'P' WHERE o_nomor = ?",
          [authNomor],
        );
        throw hookError;
      }
    }

    return { success: true, message: `Otorisasi berhasil di-${action}` };
  },
};

module.exports = authPinService;
