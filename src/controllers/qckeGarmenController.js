const service = require("../services/qckeGarmenService");
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
    const data = await service.getDetails(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const deleteQC = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { tanggal } = req.body; // Tanggal diperlukan oleh service deleteQC

    // 1. SNAPSHOT: Ambil data lama LENGKAP (Header + 2 Detail)
    let oldData = null;
    try {
      // A. Ambil Header
      const [headerRows] = await pool.query(
        "SELECT * FROM tdc_qc_hdr WHERE mut_nomor = ?",
        [nomor]
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Ambil Detail 1 (tdc_qc_dtl)
        const [detail1Rows] = await pool.query(
          "SELECT * FROM tdc_qc_dtl WHERE mutd_nomor = ? ORDER BY mutd_kode",
          [nomor]
        );

        // C. Ambil Detail 2 (tdc_qc_dtl2)
        const [detail2Rows] = await pool.query(
          "SELECT * FROM tdc_qc_dtl2 WHERE mutd_nomor = ? ORDER BY mutd_kode",
          [nomor]
        );

        // D. Gabungkan
        oldData = {
          ...header,
          items: detail1Rows,
          itemsHistory: detail2Rows
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData delete QC:", e.message);
    }

    // 2. PROSES: Jalankan service delete
    const result = await service.deleteQC(nomor, tanggal);

    // 3. AUDIT: Catat Log
    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE",            // Action
        "QC_GARMEN",         // Module
        nomor,               // Target ID
        oldData,             // Data Lama (Header + 2 Details)
        null,                // Data Baru (Null)
        `Menghapus Dokumen QC Garmen (Cabang Asal: ${oldData.mut_kecab || "Unknown"})`
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const exportDetails = async (req, res) => {
  try {
    const data = await service.getExportDetails(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getList,
  getDetails,
  deleteQC,
  exportDetails,
};
