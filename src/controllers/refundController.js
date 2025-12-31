const service = require("../services/refundService");
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
    const data = await service.getDetails(req.params.nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL APPLIED HERE]
const deleteRefund = async (req, res) => {
  try {
    const { nomor } = req.params;

    // 1. SNAPSHOT: Get old data BEFORE delete (Header + Detail)
    let oldData = null;
    try {
      // A. Get Header
      const [headerRows] = await pool.query(
        "SELECT * FROM trefund_hdr WHERE rf_nomor = ?",
        [nomor]
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Get Detail (Use rfd_nomor)
        const [detailRows] = await pool.query(
          "SELECT * FROM trefund_dtl WHERE rfd_nomor = ? ORDER BY rfd_nourut", // Order by sequence
          [nomor]
        );

        // C. Combine
        oldData = {
          ...header,
          items: detailRows
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData delete refund:", e.message);
    }

    // 2. PROCESS: Run delete service
    const result = await service.deleteRefund(nomor, req.user);

    // 3. AUDIT: Log Activity
    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE",            // Action
        "REFUND",            // Module
        nomor,               // Target ID
        oldData,             // Old Data (Snapshot)
        null,                // New Data (Null because deleted)
        `Menghapus Pengajuan Refund (Tanggal: ${oldData.rf_tanggal})`
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const exportHeaders = async (req, res) => {
  try {
    const data = await service.getExportHeaders(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
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

const getCabangOptions = async (req, res) => {
  try {
    const data = await service.getCabangOptions(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getList,
  getDetails,
  deleteRefund,
  exportHeaders,
  exportDetails,
  getCabangOptions,
};
