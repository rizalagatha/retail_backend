const service = require("../services/fskFormService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const loadInitialData = async (req, res) => {
  try {
    const { tanggal } = req.query;
    const data = await service.loadInitialData(tanggal, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
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
    const nomorDokumen = payload.header?.nomor;

    let oldData = null;

    // 2. SNAPSHOT: Ambil data lama jika Update
    if (isUpdate && nomorDokumen) {
      try {
        // Tabel Header: tform_setorkasir_hdr
        const [headerRows] = await pool.query(
          "SELECT * FROM tform_setorkasir_hdr WHERE fsk_nomor = ?",
          [nomorDokumen]
        );

        if (headerRows.length > 0) {
          const header = headerRows[0];

          // Ambil Detail 1 (Rincian Setoran)
          const [details1] = await pool.query(
            "SELECT * FROM tform_setorkasir_dtl WHERE fskd_nomor = ?",
            [nomorDokumen]
          );

          // Ambil Detail 2 (Rekapitulasi)
          const [details2] = await pool.query(
            "SELECT * FROM tform_setorkasir_dtl2 WHERE fskd2_nomor = ?",
            [nomorDokumen]
          );

          // Gabungkan menjadi struktur data lama yang lengkap
          oldData = {
            ...header,
            details1,
            details2,
          };
        }
      } catch (e) {
        console.warn("Gagal snapshot oldData save FSK:", e.message);
      }
    }

    // 3. PROSES: Simpan ke Database
    const result = await service.saveData(payload, req.user);

    // 4. AUDIT: Catat Log
    const targetId = result.nomor || nomorDokumen || "UNKNOWN";
    const action = isUpdate ? "UPDATE" : "CREATE";
    const note = `${
      action === "CREATE" ? "Input" : "Edit"
    } Form Setoran Kasir (Tanggal: ${payload.header?.tanggal})`;

    auditService.logActivity(
      req,
      action,
      "FORM_SETORAN_KASIR", // Modul FSK
      targetId,
      oldData, // Data Lama (Null jika Create)
      payload, // Data Baru
      note
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

// [AUDIT TRAIL DITERAPKAN DI SINI]
const remove = async (req, res) => {
  try {
    const { nomor } = req.params;

    // 1. SNAPSHOT: Ambil data lama sebelum dihapus
    let oldData = null;
    try {
      const [rows] = await pool.query(
        "SELECT * FROM tform_setorkasir_hdr WHERE fsk_nomor = ?",
        [nomor]
      );
      if (rows.length > 0) oldData = rows[0];
    } catch (e) {
      console.warn("Gagal snapshot oldData remove FSK:", e.message);
    }

    // 2. PROSES: Hapus data
    const result = await service.remove(nomor, req.user);

    // 3. AUDIT: Catat Log Delete
    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE", // Action
        "FORM_SETORAN_KASIR", // Module
        nomor, // Target ID
        oldData, // Data Lama
        null, // Data Baru
        `Menghapus FSK (Tanggal: ${oldData.fsk_tanggal || "-"})`
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  loadInitialData,
  loadForEdit,
  save,
  getPrintData,
  remove,
};
