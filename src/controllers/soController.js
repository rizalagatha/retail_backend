const soService = require("../services/soService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getAll = async (req, res) => {
  try {
    const data = await soService.getList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await soService.getDetails(nomor, req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getCabangList = async (req, res) => {
  try {
    const data = await soService.getCabangList(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const close = async (req, res) => {
  try {
    const { nomor, alasan } = req.body;

    // 1. SNAPSHOT: Ambil data sebelum update (Header + Detail)
    let oldData = null;
    try {
      // A. Ambil Header
      const [headerRows] = await pool.query(
        "SELECT * FROM tso_hdr WHERE so_nomor = ?",
        [nomor]
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Ambil Detail (Opsional untuk Close, tapi bagus untuk history)
        const [detailRows] = await pool.query(
          "SELECT * FROM tso_dtl WHERE sod_so_nomor = ? ORDER BY sod_nourut",
          [nomor]
        );

        // C. Gabungkan
        oldData = {
          ...header,
          items: detailRows
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData close SO:", e.message);
    }

    // 2. PROSES: Close SO
    const result = await soService.close({ ...req.body, user: req.user.kode });

    // 3. AUDIT: Catat Log Update (Closing)
    auditService.logActivity(
      req,
      "UPDATE",            // Action
      "SURAT_PESANAN",     // Module
      nomor,               // Target ID
      oldData,             // Data Lama
      { so_close: 2, so_alasan: alasan }, // Data Baru (Status Diclose)
      `Close Manual SO (Alasan: ${alasan})`
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const remove = async (req, res) => {
  try {
    const { nomor } = req.params;

    // 1. SNAPSHOT: Ambil data lama LENGKAP sebelum dihapus
    let oldData = null;
    try {
      // A. Ambil Header
      const [headerRows] = await pool.query(
        "SELECT * FROM tso_hdr WHERE so_nomor = ?",
        [nomor]
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Ambil Detail (Gunakan sod_so_nomor)
        const [detailRows] = await pool.query(
          "SELECT * FROM tso_dtl WHERE sod_so_nomor = ? ORDER BY sod_nourut",
          [nomor]
        );

        // C. Gabungkan
        oldData = {
          ...header,
          items: detailRows
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData remove SO:", e.message);
    }

    // 2. PROSES: Hapus data
    const result = await soService.remove(nomor, req.user);

    // 3. AUDIT: Catat Log Delete
    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE",            // Action
        "SURAT_PESANAN",     // Module
        nomor,               // Target ID
        oldData,             // Data Lama (Header + Items)
        null,                // Data Baru
        `Menghapus SO Customer: ${oldData.so_cus_kode || "Unknown"}`
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await soService.getDataForPrint(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getExportDetails = async (req, res) => {
  try {
    const data = await soService.getExportDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getAll,
  getDetails,
  getCabangList,
  close,
  remove,
  getPrintData,
  getExportDetails,
};
