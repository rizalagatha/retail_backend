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

// [AUDIT TRAIL DITERAPKAN DI SINI]
const cancelReceipt = async (req, res) => {
  try {
    const { nomor } = req.query; // Ini adalah nomor STBJ (Pengiriman)
    if (!nomor)
      return res.status(400).json({ message: "Parameter nomor diperlukan." });

    // 1. SNAPSHOT: Ambil data Penerimaan LENGKAP sebelum dibatalkan
    let oldData = null;
    let nomorTerima = null;

    try {
      // Langkah A: Ambil Header Penerimaan
      const [headerRows] = await pool.query(
        `SELECT ts.* FROM tdc_stbj_hdr ts WHERE ts.ts_stbj = ?`,
        [nomor]
      );
      
      if (headerRows.length > 0) {
        const header = headerRows[0];
        nomorTerima = header.ts_nomor;

        // Langkah B: Ambil Detail Penerimaan (Gunakan tsd_nomor)
        const [detailRows] = await pool.query(
          "SELECT * FROM tdc_stbj_dtl WHERE tsd_nomor = ? ORDER BY tsd_kode",
          [nomorTerima]
        );

        // Langkah C: Gabungkan
        oldData = {
          ...header,
          items: detailRows
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData cancel receipt STBJ:", e.message);
    }

    // 2. PROSES: Batalkan Penerimaan
    const result = await service.cancelReceipt(nomor, req.user);

    // 3. AUDIT: Catat Log Cancel
    if (oldData && nomorTerima) {
      auditService.logActivity(
        req,
        "CANCEL",             // Action
        "TERIMA_STBJ",        // Module
        nomorTerima,          // Target ID (Nomor Terima)
        oldData,              // Data Lama (Header + Items)
        null,                 // Data Baru
        `Membatalkan Penerimaan STBJ (Ref Kirim: ${nomor})`
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
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
        [nomor]
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
        "CANCEL",            // Action
        "TOLAK_STBJ",        // Module
        nomorTolak,          // Target ID (Nomor Tolak)
        oldData,             // Data Lama (Hanya Header)
        null,                // Data Baru
        `Membatalkan Penolakan STBJ (Ref Kirim: ${nomor})`
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
