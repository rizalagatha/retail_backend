const soDtfService = require("../services/soDtfService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getAll = async (req, res) => {
  try {
    if (!req.query.startDate || !req.query.endDate || !req.query.cabang) {
      return res
        .status(400)
        .json({ message: "Parameter filter tidak lengkap." });
    }
    const data = await soDtfService.getSoDtfList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await soDtfService.getSoDtfDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const close = async (req, res) => {
  try {
    const { nomor, alasan, user } = req.body;

    // 1. SNAPSHOT: Ambil data sebelum update (Header + 2 Detail)
    let oldData = null;
    try {
      // A. Ambil Header
      const [headerRows] = await pool.query(
        "SELECT * FROM tsodtf_hdr WHERE sd_nomor = ?",
        [nomor]
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Ambil Detail 1 (tsodtf_dtl)
        const [detail1Rows] = await pool.query(
          "SELECT * FROM tsodtf_dtl WHERE sdd_nomor = ? ORDER BY sdd_nourut",
          [nomor]
        );

        // C. Ambil Detail 2 (tsodtf_dtl2)
        const [detail2Rows] = await pool.query(
          "SELECT * FROM tsodtf_dtl2 WHERE sdd2_nomor = ? ORDER BY sdd2_nourut",
          [nomor]
        );

        // D. Gabungkan
        oldData = {
          ...header,
          items: detail1Rows,
          titikCetak: detail2Rows
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData close SO DTF:", e.message);
    }

    // 2. PROSES: Close SO DTF
    const result = await soDtfService.closeSoDtf(nomor, alasan, user);

    // 3. AUDIT: Catat Log Update (Closing)
    auditService.logActivity(
      req,
      'UPDATE',            // Action
      'SO_DTF',            // Module
      nomor,               // Target ID
      oldData,             // Data Lama
      { sd_closing: 'Y', sd_alasan: alasan }, // Data Baru
      `Close Manual SO DTF (Alasan: ${alasan})`
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const remove = async (req, res) => {
  try {
    const { nomor } = req.params;

    // 1. SNAPSHOT: Ambil data lama LENGKAP sebelum dihapus
    let oldData = null;
    try {
      // A. Ambil Header
      const [headerRows] = await pool.query(
        "SELECT * FROM tsodtf_hdr WHERE sd_nomor = ?",
        [nomor]
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Ambil Detail 1
        const [detail1Rows] = await pool.query(
          "SELECT * FROM tsodtf_dtl WHERE sdd_nomor = ? ORDER BY sdd_nourut",
          [nomor]
        );

        // C. Ambil Detail 2
        const [detail2Rows] = await pool.query(
          "SELECT * FROM tsodtf_dtl2 WHERE sdd2_nomor = ? ORDER BY sdd2_nourut",
          [nomor]
        );

        // D. Gabungkan
        oldData = {
          ...header,
          items: detail1Rows,
          titikCetak: detail2Rows
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData remove SO DTF:", e.message);
    }

    // 2. PROSES: Hapus Data
    const result = await soDtfService.remove(nomor, req.user);

    // 3. AUDIT: Catat Log Delete
    if (oldData) {
      auditService.logActivity(
        req,
        'DELETE',            // Action
        'SO_DTF',            // Module
        nomor,               // Target ID
        oldData,             // Data Lama (Header + 2 Details)
        null,                // Data Baru
        `Menghapus SO DTF (Customer: ${oldData.sd_cus_kode || 'Unknown'})`
      );
    }

    res.json(result);
  } catch (error) {
    res.status(error.message.includes("tidak bisa dihapus") || error.message.includes("tidak berhak") ? 400 : 500)
       .json({ message: error.message });
  }
};

const exportHeader = async (req, res) => {
  try {
    const data = await soDtfService.exportHeader(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const exportDetail = async (req, res) => {
  try {
    const data = await soDtfService.exportDetail(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getAll,
  getDetails,
  close,
  remove,
  exportHeader,
  exportDetail,
};