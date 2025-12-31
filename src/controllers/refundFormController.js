const service = require("../services/refundFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getInvoiceLookup = async (req, res) => {
  try {
    const data = await service.getInvoiceLookup(req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDepositLookup = async (req, res) => {
  try {
    const data = await service.getDepositLookup(req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSoDetailsForRefund = async (req, res) => {
  try {
    const { soNomor } = req.params;
    const data = await service.getSoDetailsForRefund(soNomor);
    res.json(data);
  } catch (error) {
    console.error("Error getSoDetailsForRefund:", error);
    if (error.message === "Nomor SO tidak ditemukan.") {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

const getDataForEdit = async (req, res) => {
  try {
    const data = await service.getDataForEdit(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
// [AUDIT TRAIL APPLIED HERE]
const saveData = async (req, res) => {
  try {
    const payload = req.body;

    // 1. DETECT: Is this an Update?
    const isUpdate = payload.isNew === false;
    const nomorDokumen = payload.header?.nomor;

    let oldData = null;

    // 2. SNAPSHOT: Get old data if Update (Header + Detail)
    if (isUpdate && nomorDokumen) {
      try {
        // A. Get Header
        const [headerRows] = await pool.query(
          "SELECT * FROM trefund_hdr WHERE rf_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Get Detail (Use rfd_nomor)
          const [detailRows] = await pool.query(
            "SELECT * FROM trefund_dtl WHERE rfd_nomor = ? ORDER BY rfd_nourut",
            [nomorDokumen]
          );

          // C. Combine
          oldData = {
            ...header,
            items: detailRows
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save refund:", e.message);
      }
    }

    // 3. PROCESS: Save to Database
    const result = await service.saveData(payload, req.user);

    // 4. AUDIT: Log Activity
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    let action = isUpdate ? "UPDATE" : "CREATE";
    let note = `${action === "CREATE" ? "Input" : "Edit"} Refund`;

    // Check if this is an Approval process
    if (payload.isApprover) {
      // If user clicked 'Approve' (isApproved: true in payload)
      if (payload.header?.isApproved) {
        action = "APPROVE";
        note = "Approve Pengajuan Refund";
      }
      // If user is just saving progress (reviewing)
      else {
        note = "Proses Pengajuan Refund (Review)";
      }
    }

    auditService.logActivity(
      req,
      action,
      "REFUND",
      targetId,
      oldData, // Old Data (Header + Items)
      payload, // New Data (Payload Form)
      note
    );

    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getPrintData(nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

module.exports = {
  getInvoiceLookup,
  getDepositLookup,
  getSoDetailsForRefund,
  getDataForEdit,
  saveData,
  getPrintData,
};
