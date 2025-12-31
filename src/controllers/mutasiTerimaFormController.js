const service = require("../services/mutasiTerimaFormService");
const auditService = require("../services/auditService"); // Import Audit

const loadFromKirim = async (req, res) => {
  try {
    const data = await service.loadFromKirim(req.params.nomorKirim);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const save = async (req, res) => {
  try {
    const payload = req.body;

    // 1. PROSES: Simpan ke Database
    const result = await service.save(payload, req.user);

    // 2. AUDIT: Catat Log (Action: CREATE)
    // Target ID adalah nomor Terima yang baru digenerate oleh service
    const targetId = result.nomor || "UNKNOWN";
    const refKirim = payload.header?.nomorKirim || "UNKNOWN";

    auditService.logActivity(
      req,
      "CREATE",           // Action selalu CREATE karena ini penerimaan baru
      "MUTASI_TERIMA",    // Module
      targetId,           // Nomor Terima (MST...)
      null,               // Old Value (Null karena Create)
      payload,            // New Value (Payload Form sudah lengkap Header + Items)
      `Input Penerimaan Barang (Ref Kirim: ${refKirim})` // Note informatif
    );

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { loadFromKirim, save };
