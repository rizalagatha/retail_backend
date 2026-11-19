const service = require("../services/terimaStbjService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getList = async (req, res) => {
  try {
    const data = await service.getList(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor) {
      return res.status(400).json({ message: "Parameter nomor diperlukan." });
    }
    const data = await service.getDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Pembatalan penerimaan dikunci: satu STBJ bisa punya banyak nomor penerimaan (parsial)
// dan SJ/mutasi otomatis tidak terikat ke nomor penerimaan tertentu.
const cancelReceipt = async (req, res) => {
  res.status(403).json({
    message: "Pembatalan penerimaan STBJ dikunci. Hubungi EDP untuk koreksi.",
  });
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const cancelRejection = async (req, res) => {
  try {
    const { nomor } = req.query; // Ini adalah nomor STBJ (Pengiriman)
    if (!nomor)
      return res.status(400).json({ message: "Parameter nomor diperlukan." });

    // 1. SNAPSHOT: Ambil data Penolakan sebelum dibatalkan (Header Only)
    let oldData = null;
    let nomorTolak = null;

    try {
      // Ambil data tolak berdasarkan referensi STBJ
      const [rows] = await pool.query(
        `SELECT * FROM tdc_stbjtolak WHERE tl_stbj = ?`,
        [nomor],
      );

      if (rows.length > 0) {
        oldData = rows[0];
        nomorTolak = oldData.tl_nomor;
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData cancel rejection STBJ:", e.message);
    }

    // 2. PROSES: Batalkan Penolakan
    const result = await service.cancelRejection(nomor, req.user);

    // 3. AUDIT: Catat Log Cancel
    if (oldData && nomorTolak) {
      auditService.logActivity(
        req,
        "CANCEL", // Action
        "TOLAK_STBJ", // Module
        nomorTolak, // Target ID (Nomor Tolak)
        oldData, // Data Lama (Hanya Header)
        null, // Data Baru
        `Membatalkan Penolakan STBJ (Ref Kirim: ${nomor})`,
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const exportDetails = async (req, res) => {
  try {
    const data = await service.getExportDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getList,
  getDetails,
  cancelReceipt,
  cancelRejection,
  exportDetails,
};
