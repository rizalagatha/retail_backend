const service = require("../services/mutasiStokFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const searchSo = async (req, res) => {
  try {
    const { term, page, itemsPerPage } = req.query;
    const data = await service.searchSo(term, page, itemsPerPage, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const loadFromSo = async (req, res) => {
  try {
    const { nomorSo } = req.params;
    const data = await service.loadFromSo(nomorSo, req.user);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const loadForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.loadForEdit(nomor, req.user);
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
    const isUpdate = payload.isNew === false;
    const nomorDokumen = payload.header?.nomor || payload.nomor;

    let oldData = null;

    // 2. SNAPSHOT: Ambil data lama LENGKAP jika Update
    if (isUpdate && nomorDokumen) {
      try {
        // A. Ambil Header
        const [headerRows] = await pool.query(
          "SELECT * FROM tmutasistok_hdr WHERE mso_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Ambil Detail (Gunakan msod_nomor)
          const [detailRows] = await pool.query(
            "SELECT * FROM tmutasistok_dtl WHERE msod_nomor = ? ORDER BY msod_nourut",
            [nomorDokumen]
          );

          // C. Gabungkan
          oldData = {
            ...header,
            items: detailRows
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save mutasi stok:", e.message);
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
      "MUTASI_STOK",
      targetId,
      oldData, // Data Lama (Header + Items)
      payload, // Data Baru (Payload Form)
      `${action === "CREATE" ? "Input" : "Edit"} Mutasi Stok`
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
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

const exportDetails = async (req, res) => {
  try {
    const data = await service.getExportDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  searchSo,
  loadFromSo,
  loadForEdit,
  save,
  getPrintData,
  exportDetails,
};
