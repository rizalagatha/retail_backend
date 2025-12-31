const service = require("../services/tolakStbjFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const loadFromStbj = async (req, res) => {
  try {
    const { nomorStbj } = req.query;
    if (!nomorStbj) {
      return res
        .status(400)
        .json({ message: "Parameter nomorStbj diperlukan." });
    }
    const data = await service.loadFromStbj(nomorStbj);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const save = async (req, res) => {
  try {
    const payload = req.body;

    // 1. DETEKSI: Apakah ini Update?
    const isUpdate = payload.isEdit === true;
    const nomorDokumen = payload.header?.nomor;

    let oldData = null;

    // 2. SNAPSHOT: Ambil data lama jika Update (Header Only)
    if (isUpdate && nomorDokumen) {
      try {
        // Tabel: tdc_stbjtolak, PK: tl_nomor
        // Karena tidak ada detail, cukup ambil row ini saja
        const [rows] = await pool.query(
          "SELECT * FROM tdc_stbjtolak WHERE tl_nomor = ?",
          [nomorDokumen]
        );
        if (rows.length > 0) oldData = rows[0];
      } catch (e) {
        console.warn("Gagal snapshot oldData save tolak STBJ:", e.message);
      }
    }

    // 3. PROSES: Simpan ke Database
    const result = await service.save(payload, req.user);

    // 4. AUDIT: Catat Log
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";

    const refStbj = payload.header?.nomorStbj || "";
    const note = `${action === "CREATE" ? "Input" : "Edit"} Tolak STBJ (Ref STBJ: ${refStbj})`;

    auditService.logActivity(
      req,
      action,
      "TOLAK_STBJ",
      targetId,
      oldData, // Data Lama (Hanya Header, null jika Create)
      payload, // Data Baru
      note
    );

    res.status(201).json(result);
  } catch (error) {
    console.error("Save Tolak STBJ Controller Error:", error);
    res.status(500).json({ message: error.message || "Gagal menyimpan data." });
  }
};

module.exports = {
  loadFromStbj,
  save,
};
