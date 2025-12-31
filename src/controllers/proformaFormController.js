const service = require("../services/proformaFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getDataFromSO = async (req, res) => {
  try {
    const { soNumber } = req.params;
    const { branchCode } = req.query;
    if (!soNumber || !branchCode) {
      return res
        .status(400)
        .json({ message: "Nomor SO dan kode cabang diperlukan." });
    }
    const data = await service.getDataFromSO(soNumber, branchCode);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getDataForEdit = async (req, res) => {
  try {
    const { id } = req.params;
    const data = await service.getDataForEdit(id);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const saveNew = async (req, res) => {
  try {
    const payload = req.body;

    // 1. PROSES: Simpan Baru
    const result = await service.saveData(payload, req.user);

    // 2. AUDIT: Catat Log Create
    const targetId = result.nomor || "UNKNOWN";
    const refSO = payload.header?.nomorSo || "UNKNOWN";

    auditService.logActivity(
      req,
      "CREATE",
      "PROFORMA_INVOICE",
      targetId,
      null,    // Old Data (Null karena Create)
      payload, // New Data (Payload Form sudah lengkap Header + Items)
      `Input Proforma Baru (Ref SO: ${refSO})`
    );

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const updateExisting = async (req, res) => {
  try {
    const nomorDokumen = req.params.id;
    const payload = {
      header: { ...req.body.header, nomor: nomorDokumen },
      items: req.body.items,
    };

    // 1. SNAPSHOT: Ambil data lama LENGKAP jika Update
    let oldData = null;
    try {
      // A. Ambil Header
      const [headerRows] = await pool.query(
        "SELECT * FROM tinv_hdr WHERE inv_nomor = ?",
        [nomorDokumen]
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Ambil Detail (Gunakan invd_inv_nomor)
        const [detailRows] = await pool.query(
          "SELECT * FROM tinv_dtl WHERE invd_inv_nomor = ? ORDER BY invd_nourut",
          [nomorDokumen]
        );

        // C. Gabungkan
        oldData = {
          ...header,
          items: detailRows
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData update proforma:", e.message);
    }

    // 2. PROSES: Update Data
    const result = await service.saveData(payload, req.user);

    // 3. AUDIT: Catat Log Update
    auditService.logActivity(
      req,
      "UPDATE",
      "PROFORMA_INVOICE",
      nomorDokumen,
      oldData, // Data Lama (Header + Items)
      payload, // Data Baru (Payload Form)
      `Update Proforma Invoice`
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const lookupSO = async (req, res) => {
  try {
    const result = await service.lookupSO(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getPrintData(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

module.exports = {
  getDataFromSO,
  getDataForEdit,
  saveNew,
  updateExisting,
  lookupSO,
  getPrintData,
};
