const service = require("../services/terimaStbjFormService");
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

    // 2. SNAPSHOT: Ambil data lama LENGKAP jika Update
    if (isUpdate && nomorDokumen) {
      try {
        // A. Ambil Header
        const [headerRows] = await pool.query(
          "SELECT * FROM tdc_stbj_hdr WHERE ts_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Ambil Detail (Gunakan tsd_nomor)
          const [detailRows] = await pool.query(
            "SELECT * FROM tdc_stbj_dtl WHERE tsd_nomor = ? ORDER BY tsd_kode",
            [nomorDokumen]
          );

          // C. Gabungkan
          oldData = {
            ...header,
            items: detailRows
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save STBJ:", e.message);
      }
    }

    // 3. PROSES: Simpan ke Database
    const result = await service.save(payload, req.user);

    // 4. AUDIT: Catat Log
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";

    // Note khusus: Mencatat referensi STBJ asal
    const refStbj = payload.header?.nomorStbj || "";
    const note = `${action === "CREATE" ? "Input" : "Edit"} Terima STBJ (Ref STBJ: ${refStbj})`;

    auditService.logActivity(
      req,
      action,
      "TERIMA_STBJ",
      targetId,
      oldData, // Data Lama (Header + Items)
      payload, // Data Baru (Payload Form)
      note
    );

    res.status(201).json(result);
  } catch (error) {
    console.error("Save STBJ Controller Error:", error);
    res.status(500).json({ message: error.message || "Gagal menyimpan data." });
  }
};

module.exports = {
  loadFromStbj,
  save,
};
