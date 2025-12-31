const service = require("../services/pengajuanBarcodeService");
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
    const data = await service.getDetails(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const remove = async (req, res) => {
  try {
    const { nomor } = req.params;

    // 1. SNAPSHOT: Ambil data lama LENGKAP (Header + 2 Detail)
    let oldData = null;
    try {
      // A. Ambil Header
      const [headerRows] = await pool.query(
        "SELECT * FROM tpengajuanbarcode_hdr WHERE pc_nomor = ?",
        [nomor]
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Ambil Detail 1 (Barang)
        const [detail1Rows] = await pool.query(
          "SELECT * FROM tpengajuanbarcode_dtl WHERE pcd_nomor = ? ORDER BY pcd_nourut", 
          [nomor]
        );

        // C. Ambil Detail 2 (Harga/Komponen)
        const [detail2Rows] = await pool.query(
          "SELECT * FROM tpengajuanbarcode_dtl2 WHERE pcd2_nomor = ? ORDER BY pcd2_nourut", 
          [nomor]
        );

        // D. Gabungkan
        oldData = {
          ...header,
          itemsBarang: detail1Rows,
          itemsHarga: detail2Rows
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData remove pengajuan barcode:", e.message);
    }

    // 2. PROSES: Jalankan service remove
    const result = await service.remove(nomor, req.user);

    // 3. AUDIT: Catat Log
    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE",            // Action
        "PENGAJUAN_BARCODE", // Module
        nomor,               // Target ID
        oldData,             // Data Lama (Header + 2 Details)
        null,                // Data Baru (Null)
        `Menghapus Pengajuan Barcode (Cabang: ${oldData.pc_cab || "Unknown"})`
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getCabangOptions = async (req, res) => {
  try {
    const data = await service.getCabangOptions(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const exportDetails = async (req, res) => {
  try {
    const data = await service.getExportDetails(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getList,
  getDetails,
  remove,
  getCabangOptions,
  exportDetails,
};
