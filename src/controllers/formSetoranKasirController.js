const service = require("../services/formSetoranKasirService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getCabangList = async (req, res) => {
  try {
    const data = await service.getCabangList(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getList = async (req, res) => {
  try {
    const data = await service.getList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const data = await service.getDetails(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const remove = async (req, res) => {
  try {
    const { nomor } = req.params;

    // 1. SNAPSHOT: Ambil data lama sebelum dihapus
    let oldData = null;
    try {
      const [rows] = await pool.query(
        "SELECT * FROM tform_setorkasir_hdr WHERE fsk_nomor = ?",
        [nomor]
      );
      if (rows.length > 0) oldData = rows[0];
    } catch (e) {
      console.warn("Gagal snapshot oldData remove FSK (List):", e.message);
    }

    // 2. PROSES: Hapus data
    const result = await service.remove(nomor, req.user);

    // 3. AUDIT: Catat Log Delete
    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE", // Action
        "FORM_SETORAN_KASIR", // Module
        nomor, // Target ID
        oldData, // Data Lama
        null, // Data Baru
        `Menghapus FSK dari List (Tanggal: ${oldData.fsk_tanggal || "-"})`
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const exportHeaders = async (req, res) => {
  try {
    const data = await service.getExportHeaders(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
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
  getCabangList,
  getList,
  getDetails,
  remove,
  exportHeaders,
  exportDetails,
};
