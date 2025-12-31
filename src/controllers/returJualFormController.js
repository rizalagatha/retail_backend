const service = require("../services/returJualFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const loadFromInvoice = async (req, res) => {
  try {
    const data = await service.loadFromInvoice(req.params.nomorInvoice);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getForEdit = async (req, res) => {
  try {
    const data = await service.getForEdit(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

// [AUDIT TRAIL APPLIED HERE]
const save = async (req, res) => {
  try {
    const payload = req.body;

    // 1. DETECT: Is this an Update?
    const isUpdate = payload.isNew === false;
    const nomorDokumen = payload.header?.nomor || payload.nomor;

    let oldData = null;

    // 2. SNAPSHOT: Get old data if Update (Header + Detail)
    if (isUpdate && nomorDokumen) {
      try {
        // A. Get Header
        const [headerRows] = await pool.query(
          "SELECT * FROM trj_hdr WHERE rj_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Get Detail (Use rjd_nomor)
          const [detailRows] = await pool.query(
            "SELECT * FROM trj_dtl WHERE rjd_nomor = ? ORDER BY rjd_nourut",
            [nomorDokumen]
          );

          // C. Combine
          oldData = {
            ...header,
            items: detailRows
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save retur jual:", e.message);
      }
    }

    // 3. PROCESS: Save to Database
    payload.user = req.user;
    const result = await service.save(payload, req.user);

    // 4. AUDIT: Log Activity
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";

    auditService.logActivity(
      req,
      action,
      "RETUR_JUAL",
      targetId,
      oldData, // Old Data (Header + Items)
      payload, // New Data (Payload Form)
      `${action === "CREATE" ? "Input" : "Edit"} Retur Jual (Ref Invoice: ${payload.header?.invoice})`
    );

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const lookupInvoices = async (req, res) => {
  try {
    const data = await service.lookupInvoices(req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const findByBarcode = async (req, res) => {
  try {
    const data = await service.findByBarcode(req.params.barcode);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const data = await service.getPrintData(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

module.exports = {
  loadFromInvoice,
  getForEdit,
  save,
  lookupInvoices,
  findByBarcode,
  getPrintData,
};
