const suratJalanService = require("../services/suratJalanService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getList = async (req, res) => {
  try {
    const data = await suratJalanService.getList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await suratJalanService.getDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const remove = async (req, res) => {
  try {
    const { nomor } = req.params;

    // 1. SNAPSHOT: Ambil data lama LENGKAP (Header + Detail)
    let oldData = null;
    try {
      // A. Ambil Header
      const [headerRows] = await pool.query(
        "SELECT * FROM tdc_sj_hdr WHERE sj_nomor = ?",
        [nomor]
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Ambil Detail (Gunakan sjd_nomor)
        const [detailRows] = await pool.query(
          "SELECT * FROM tdc_sj_dtl WHERE sjd_nomor = ? ORDER BY sjd_kode",
          [nomor]
        );

        // C. Gabungkan
        oldData = {
          ...header,
          items: detailRows
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData remove SJ:", e.message);
    }

    // 2. PROSES: Jalankan service remove
    const result = await suratJalanService.remove(nomor);

    // 3. AUDIT: Catat Log Delete
    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE",            // Action
        "SURAT_JALAN",       // Module
        nomor,               // Target ID
        oldData,             // Data Lama (Header + Items)
        null,                // Data Baru (Null)
        `Menghapus Surat Jalan (Ke Store: ${oldData.sj_kecab || "Unknown"})`
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getRequestStatus = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await suratJalanService.getRequestStatus(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const submitRequest = async (req, res) => {
  try {
    // Menambahkan kdUser dari token ke dalam payload
    const payload = { ...req.body, kdUser: req.user.id };

    // 1. PROSES: Submit Request Edit
    const result = await suratJalanService.submitRequest(payload);

    // 2. AUDIT: Catat Log Request Edit
    // Action: REQUEST_EDIT (Custom Action) atau UPDATE
    const targetId = payload.nomor || "UNKNOWN";

    auditService.logActivity(
      req,
      "REQUEST_EDIT", // Action khusus permintaan edit
      "SURAT_JALAN", // Module
      targetId,
      null, // Old Data (tidak relevan/bisa kosong)
      payload, // Data Baru (alasan, keterangan, dll)
      `Request Edit Surat Jalan (Alasan: ${payload.alasan})`
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await suratJalanService.getPrintData(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const exportDetails = async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      cabang: req.query.cabang,
      kodeBarang: req.query.kodeBarang || "",
    };

    const data = await suratJalanService.exportDetails(filters);
    res.json(data);
  } catch (error) {
    console.error("❌ Export Error:", error);
    res.status(500).json({ message: error.message });
  }
};

const getCabangList = async (req, res) => {
  try {
    const data = await suratJalanService.getCabangList(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getList,
  getDetails,
  remove,
  getRequestStatus,
  submitRequest,
  getPrintData,
  exportDetails,
  getCabangList,
};
