const mintaBarangService = require("../services/mintaBarangService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool

const getAll = async (req, res) => {
  try {
    const data = await mintaBarangService.getList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await mintaBarangService.getDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getCabangList = async (req, res) => {
  try {
    const data = await mintaBarangService.getCabangList(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const remove = async (req, res) => {
  try {
    const { nomor } = req.params;

    // 1. SNAPSHOT: Ambil data lama sebelum dihapus (Header + Detail)
    let oldData = null;
    try {
      // A. Ambil Header
      const [headerRows] = await pool.query(
        "SELECT * FROM tmintabarang_hdr WHERE mt_nomor = ?",
        [nomor]
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Ambil Detail (PENTING: Gunakan mtd_nomor)
        const [detailRows] = await pool.query(
          "SELECT * FROM tmintabarang_dtl WHERE mtd_nomor = ? ORDER BY mtd_nourut", // Asumsi ada mtd_nourut/kode
          [nomor]
        );

        // C. Gabungkan
        oldData = {
          ...header,
          items: detailRows
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData remove minta barang:", e.message);
    }

    // 2. PROSES: Jalankan service remove
    const result = await mintaBarangService.remove(nomor, req.user);

    // 3. AUDIT: Catat Log
    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE",            // Action
        "MINTA_BARANG",      // Module
        nomor,               // Target ID
        oldData,             // Data Lama (Header + Items)
        null,                // Data Baru (Null)
        `Menghapus Dokumen Permintaan Barang (Tujuan: ${oldData.mt_cabang_tujuan || "Unknown"})` // Sesuaikan nama kolom tujuan
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getExportDetails = async (req, res) => {
  try {
    const data = await mintaBarangService.getExportDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getAll,
  getDetails,
  getCabangList,
  remove,
  getExportDetails,
};
