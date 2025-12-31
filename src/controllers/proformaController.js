const service = require("../services/proformaService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getList = async (req, res) => {
  try {
    const data = await service.getList(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.query;
    if (!nomor)
      return res.status(400).json({ message: "Parameter 'nomor' diperlukan." });
    const data = await service.getDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const deleteProforma = async (req, res) => {
  try {
    const { nomor } = req.params;

    // 1. SNAPSHOT: Ambil data lama LENGKAP (Header + Detail)
    let oldData = null;
    try {
      // A. Ambil Header
      const [headerRows] = await pool.query(
        "SELECT * FROM tinv_hdr WHERE inv_nomor = ?",
        [nomor]
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Ambil Detail (Gunakan invd_inv_nomor)
        const [detailRows] = await pool.query(
          "SELECT * FROM tinv_dtl WHERE invd_inv_nomor = ? ORDER BY invd_nourut",
          [nomor]
        );

        // C. Gabungkan
        oldData = {
          ...header,
          items: detailRows
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData delete proforma:", e.message);
    }

    // 2. PROSES: Jalankan service delete
    const result = await service.deleteProforma(nomor, req.user);

    // 3. AUDIT: Catat Log
    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE",            // Action
        "PROFORMA_INVOICE",  // Module
        nomor,               // Target ID
        oldData,             // Data Lama (Header + Items)
        null,                // Data Baru (Null)
        `Menghapus Proforma Invoice (Customer: ${oldData.inv_cus_kode || "Unknown"})`
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const exportDetail = async (req, res) => {
  try {
    const data = await service.getExportDetails(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getBranchOptions = async (req, res) => {
  try {
    const data = await service.getBranchOptions(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getList,
  getDetails,
  deleteProforma,
  exportDetail,
  getBranchOptions,
};
