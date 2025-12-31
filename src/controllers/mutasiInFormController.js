const service = require("../services/mutasiInFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

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
          "SELECT * FROM tmutasiin_hdr WHERE mi_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // B. Ambil Detail (Gunakan mid_nomor)
          const [detailRows] = await pool.query(
            "SELECT * FROM tmutasiin_dtl WHERE mid_nomor = ?", 
            [nomorDokumen]
          );

          // C. Gabungkan
          oldData = {
            ...header,
            items: detailRows
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save mutasi in:", e.message);
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
      "MUTASI_IN",
      targetId,
      oldData, // Data Lama (Header + Items)
      payload, // Data Baru (Payload Form sudah lengkap header+items)
      `${action === "CREATE" ? "Input" : "Edit"} Penerimaan Mutasi`
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const loadFromMo = async (req, res) => {
  try {
    const data = await service.loadFromMo(req.params.nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const loadForEdit = async (req, res) => {
  try {
    const data = await service.loadForEdit(req.params.nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
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

const searchMutasiOut = async (req, res) => {
  try {
    const { term, page = 1, itemsPerPage = 10 } = req.query;
    const result = await service.searchMutasiOut(
      term,
      Number(page),
      Number(itemsPerPage),
      req.user
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
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
  save,
  loadFromMo,
  loadForEdit,
  getPrintData,
  searchMutasiOut,
  exportDetails,
};
