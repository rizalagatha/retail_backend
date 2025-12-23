const pool = require("../config/database");
const { format } = require("date-fns");

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
    const { transaksi, jenis, keterangan, nominal, cabang, user } = payload;

    // 1. Generate Nomor Urut Baru
    const authNomor = await generateAuthNumber(cabang);

    const query = `
            INSERT INTO totorisasi 
            (o_nomor, o_transaksi, o_jenis, o_ket, o_nominal, o_cab, o_status, o_requester, o_created)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, NOW())
        `;

    await pool.query(query, [
      authNomor,
      transaksi || "NEW_TRX",
      jenis,
      keterangan,
      nominal || 0,
      cabang,
      user,
    ]);

    return {
      success: true,
      message: "Permintaan otorisasi terkirim ke Manager.",
      authNomor: authNomor,
    };
  },

  // ... function checkStatus, getPendingRequests, processRequest tetap sama ...
  // (Pastikan function lainnya tetap ada di sini)

  async checkStatus(authNomor) {
    const query = `SELECT o_status, o_approver FROM totorisasi WHERE o_nomor = ?`;
    const [rows] = await pool.query(query, [authNomor]);

    if (rows.length === 0) {
      throw new Error("Data otorisasi tidak ditemukan.");
    }

    const data = rows[0];
    let statusText = "PENDING";
    if (data.o_status === 1) statusText = "APPROVED";
    if (data.o_status === 2) statusText = "REJECTED";

    return {
      status: statusText,
      isApproved: data.o_status === 1,
      approver: data.o_approver,
    };
  },

  async getPendingRequests(cabang) {
    let query = `SELECT * FROM totorisasi WHERE o_status = 0 `;
    const params = [];

    // Jika manager cabang (bukan pusat/KDC), filter per cabang
    if (cabang !== "KDC") {
      query += `AND o_cab = ? `;
      params.push(cabang);
    }

    query += `ORDER BY o_created DESC`;

    const [rows] = await pool.query(query, params);
    return rows;
  },

  async processRequest(authNomor, managerUser, action) {
    // action: 'APPROVE' atau 'REJECT'
    const newStatus = action === "APPROVE" ? 1 : 2;

    // [FIX] Jangan update kolom 'o_pin'.
    // Cukup update status, approver, dan waktu approve.
    const query = `
            UPDATE totorisasi 
            SET 
                o_status = ?, 
                o_approver = ?, 
                o_approved_at = NOW()
            WHERE o_nomor = ? AND o_status = 0
        `;

    // Parameter array harus urut sesuai tanda tanya (?) di atas
    // 1. newStatus -> o_status
    // 2. managerUser -> o_approver
    // 3. authNomor -> o_nomor
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
