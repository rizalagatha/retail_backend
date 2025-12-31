const service = require("../services/mutasiKirimService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getCabangList = async (req, res) => {
  try {
    const data = await service.getCabangList(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getList = async (req, res) => {
  try {
    const data = await service.getList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const remove = async (req, res) => {
  try {
    const { nomor } = req.params;

    // 1. SNAPSHOT: Ambil data lama LENGKAP (Header + Detail)
    let oldData = null;
    try {
      // A. Ambil Header
      const [headerRows] = await pool.query(
        "SELECT * FROM tmsk_hdr WHERE msk_nomor = ?",
        [nomor]
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Ambil Detail (Gunakan mskd_nomor)
        const [detailRows] = await pool.query(
          "SELECT * FROM tmsk_dtl WHERE mskd_nomor = ? ORDER BY mskd_kode", // Order by kode/idrec
          [nomor]
        );

        // C. Gabungkan
        oldData = {
          ...header,
          items: detailRows
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData remove mutasi kirim:", e.message);
    }

    // 2. PROSES: Jalankan service remove
    const result = await service.remove(nomor, req.user);

    // 3. AUDIT: Catat Log
    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE",            // Action
        "MUTASI_KIRIM",      // Module
        nomor,               // Target ID
        oldData,             // Data Lama (Header + Items)
        null,                // Data Baru (Null)
        `Menghapus Dokumen Mutasi Kirim (Tujuan: ${oldData.msk_cabang_tujuan || "Unknown"})`
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const searchProducts = async (req, res) => {
  try {
    const data = await service.searchProducts(req.query);
    res.json(data);
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
  getCabangList,
  getList,
  getDetails,
  remove,
  searchProducts,
  exportDetails,
};
