const service = require("../services/returJualService");
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

const getPaymentLinks = async (req, res) => {
  try {
    const data = await service.getPaymentLinks(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL APPLIED HERE]
const remove = async (req, res) => {
  try {
    const { nomor } = req.params;

    // 1. SNAPSHOT: Get old data BEFORE delete (Header + Detail)
    let oldData = null;
    try {
      // A. Get Header
      const [headerRows] = await pool.query(
        "SELECT * FROM trj_hdr WHERE rj_nomor = ?",
        [nomor]
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Get Detail (Use rjd_nomor)
        const [detailRows] = await pool.query(
          "SELECT * FROM trj_dtl WHERE rjd_nomor = ? ORDER BY rjd_nourut", // Order by sequence
          [nomor]
        );

        // C. Combine
        oldData = {
          ...header,
          items: detailRows
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData remove retur jual:", e.message);
    }

    // 2. PROCESS: Run remove service
    const result = await service.remove(nomor, req.user);

    // 3. AUDIT: Log Activity
    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE",            // Action
        "RETUR_JUAL",        // Module
        nomor,               // Target ID
        oldData,             // Old Data (Snapshot)
        null,                // New Data (Null because deleted)
        `Menghapus Retur Jual (Customer: ${oldData.rj_cus_kode || "Unknown"})`
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
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
  getPaymentLinks,
  remove,
  getCabangOptions,
  exportDetails,
};
