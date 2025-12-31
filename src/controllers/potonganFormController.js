const service = require("../services/potonganFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getInitialData = async (req, res) => {
  try {
    const data = await service.getInitialData(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getCustomerLookup = async (req, res) => {
  try {
    const data = await service.getCustomerLookup(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getInvoiceLookup = async (req, res) => {
  try {
    const { customerKode, gudangKode } = req.query;
    const data = await service.getInvoiceLookup(customerKode, gudangKode);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDataForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDataForEdit(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const saveData = async (req, res) => {
  try {
    const payload = req.body;

    // 1. DETEKSI: Apakah ini Update?
    // Gunakan flag 'isEditMode' atau 'isNew' sesuai frontend Anda
    const isUpdate = payload.isEditMode === true; // Sesuaikan jika frontend pakai isNew

    // Ambil nomor dokumen dari dalam object header
    const nomorDokumen = payload.header?.nomor;

    let oldData = null;

    // 2. SNAPSHOT: Ambil data lama LENGKAP jika Update
    if (isUpdate && nomorDokumen) {
      try {
        // A. Ambil Header
        const [headerRows] = await pool.query(
          "SELECT * FROM tpotongan_hdr WHERE pt_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Ambil Detail (Gunakan ptd_nomor)
          const [detailRows] = await pool.query(
            "SELECT * FROM tpotongan_dtl WHERE ptd_nomor = ? ORDER BY ptd_inv",
            [nomorDokumen]
          );

          // C. Gabungkan
          oldData = {
            ...header,
            items: detailRows
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save potongan:", e.message);
      }
    }

    // 3. PROSES: Simpan ke Database
    const result = await service.saveData(payload, req.user);

    // 4. AUDIT: Catat Log
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";

    auditService.logActivity(
      req,
      action,
      "POTONGAN",
      targetId,
      oldData, // Data Lama (Header + Items)
      payload, // Data Baru (Payload Form)
      `${action === "CREATE" ? "Input" : "Edit"} Potongan Piutang`
    );

    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getInitialData,
  getCustomerLookup,
  getInvoiceLookup,
  getDataForEdit,
  saveData,
};
