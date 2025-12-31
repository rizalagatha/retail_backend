const mutasiOutService = require("../services/mutasiOutService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getAll = async (req, res) => {
  try {
    const data = await mutasiOutService.getList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await mutasiOutService.getDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getCabangList = async (req, res) => {
  try {
    const data = await mutasiOutService.getCabangList(req.user);
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
        "SELECT * FROM tmutasiout_hdr WHERE mo_nomor = ?",
        [nomor]
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Ambil Detail (Gunakan mod_nomor)
        const [detailRows] = await pool.query(
          "SELECT * FROM tmutasiout_dtl WHERE mod_nomor = ? ORDER BY mod_kode", // Order by kode/idrec
          [nomor]
        );

        // C. Gabungkan
        oldData = {
          ...header,
          items: detailRows
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData remove mutasi out:", e.message);
    }

    // 2. PROSES: Jalankan service remove
    const result = await mutasiOutService.remove(nomor, req.user);

    // 3. AUDIT: Catat Log
    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE",            // Action
        "MUTASI_OUT",        // Module
        nomor,               // Target ID
        oldData,             // Data Lama (Header + Items)
        null,                // Data Baru (Null)
        `Menghapus Dokumen Mutasi Keluar (Tujuan: ${oldData.mo_cabang_tujuan || "Unknown"})`
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getAll,
  getDetails,
  getCabangList,
  remove,
};
