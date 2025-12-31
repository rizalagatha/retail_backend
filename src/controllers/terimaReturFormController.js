const service = require("../services/terimaReturFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const loadFromKirim = async (req, res) => {
  try {
    const data = await service.loadFromKirim(req.params.nomorKirim);
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
          "SELECT * FROM tdcrb_hdr WHERE rb_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Ambil Detail (Gunakan rbd_nomor)
          const [detailRows] = await pool.query(
            "SELECT * FROM tdcrb_dtl WHERE rbd_nomor = ? ORDER BY rbd_kode",
            [nomorDokumen]
          );

          // C. Gabungkan
          oldData = {
            ...header,
            items: detailRows
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save terima retur:", e.message);
      }
    }

    // 3. PROSES: Simpan ke Database
    const result = await service.save(payload, req.user);

    // 4. AUDIT: Catat Log
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";

    // Note khusus: Mencatat nomor referensi kirim jika ada
    const refKirim = payload.header?.nomorRb || "";
    const note = `${action === "CREATE" ? "Input" : "Edit"} Terima Retur (Ref Kirim: ${refKirim})`;

    auditService.logActivity(
      req,
      action,
      "TERIMA_RETUR",
      targetId,
      oldData, // Data Lama (Header + Items)
      payload, // Data Baru (Payload Form)
      note
    );

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  loadFromKirim,
  getForEdit,
  save,
};
