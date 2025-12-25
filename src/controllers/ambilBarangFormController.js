const service = require("../services/ambilBarangFormService");

const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const data = await service.getDataForEdit(id);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const saveNew = async (req, res) => {
  try {
    const payload = req.body;

    // [FIX UTAMA] Logika Prioritas User:
    // 1. req.user       -> Dari Token (Paling aman)
    // 2. payload.user   -> Dari Frontend (Fix yang kita buat tadi)
    // 3. Default Object -> Agar tidak pernah NULL / Error di Database
    const user = req.user ||
      payload.user || { kode: "SYSTEM", nama: "System", id: "SYSTEM" };

    // Kirim 'user' yang sudah pasti ada isinya ke service
    const result = await service.saveData(payload, user);

    res.status(201).json(result);
  } catch (error) {
    console.error("Error saveNew:", error);
    res.status(500).json({ message: error.message });
  }
};

const updateExisting = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body;

    // Terapkan logika yang sama untuk Update
    const user = req.user ||
      payload.user || { kode: "SYSTEM", nama: "System", id: "SYSTEM" };

    // Pastikan ID di payload sinkron dengan params (opsional tapi baik)
    if (payload.header) {
      payload.header.nomor = id;
    }

    const result = await service.saveData(payload, user);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error updateData:", error);
    res.status(500).json({ message: error.message });
  }
};

const lookupProductByBarcode = async (req, res) => {
  try {
    const { barcode, gudang } = req.query;
    if (!barcode || !gudang) {
      return res
        .status(400)
        .json({ message: "Parameter 'barcode' dan 'gudang' diperlukan." });
    }
    const data = await service.lookupProductByBarcode(barcode, gudang);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const validatePin = async (req, res) => {
  try {
    const { code, pin } = req.body;
    const result = await service.validateSavePin(code, pin);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getApprovalStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await service.getApprovalStatus(id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getById,
  saveNew,
  updateExisting,
  lookupProductByBarcode,
  validatePin,
  getApprovalStatus,
};
