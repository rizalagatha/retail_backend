const service = require("../services/terimaReturService");
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
const cancelReceipt = async (req, res) => {
  try {
    const { nomor } = req.params; // Ini adalah nomor pengiriman (rb_nomor di trbdc_hdr)

    // 1. SNAPSHOT: Ambil data penerimaan LENGKAP SEBELUM dihapus
    let oldData = null;
    let nomorTerima = null;

    try {
      // Langkah A: Cari tahu dulu nomor terimanya apa dari tabel pengiriman
      const [headerRows] = await pool.query(
        `SELECT t.* FROM trbdc_hdr h
         LEFT JOIN tdcrb_hdr t ON h.rb_noterima = t.rb_nomor
         WHERE h.rb_nomor = ?`,
        [nomor]
      );

      if (headerRows.length > 0 && headerRows[0].rb_nomor) { // Pastikan rb_nomor (nomor terima) ada
        const header = headerRows[0];
        nomorTerima = header.rb_nomor;

        // Langkah B: Ambil Detail (Gunakan rbd_nomor)
        const [detailRows] = await pool.query(
          "SELECT * FROM tdcrb_dtl WHERE rbd_nomor = ? ORDER BY rbd_kode",
          [nomorTerima]
        );

        // Langkah C: Gabungkan
        oldData = {
          ...header,
          items: detailRows
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData cancel terima retur:", e.message);
    }

    // 2. PROSES: Batalkan Penerimaan
    const result = await service.cancelReceipt(nomor, req.user);

    // 3. AUDIT: Catat Log Cancel
    if (oldData && nomorTerima) {
      auditService.logActivity(
        req,
        "CANCEL",            // Action khusus pembatalan
        "TERIMA_RETUR",      // Module
        nomorTerima,         // Target ID (Nomor Terima)
        oldData,             // Data Lama (Header + Items)
        null,                // Data Baru (Null karena dihapus)
        `Membatalkan Penerimaan Retur (Ref Kirim: ${nomor})`
      );
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const submitChangeRequest = async (req, res) => {
  try {
    // 1. PROSES: Submit Request
    const result = await service.submitChangeRequest(req.body, req.user);

    // 2. AUDIT: Catat Log Request Edit
    const targetId = req.body.nomorTerima || "UNKNOWN";

    auditService.logActivity(
      req,
      "REQUEST_EDIT", // Action
      "TERIMA_RETUR", // Module
      targetId, // Target ID
      null, // Old Data
      req.body, // Data Baru (Request Payload)
      `Request Edit Terima Retur (Alasan: ${req.body.alasan})`
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
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
  cancelReceipt,
  submitChangeRequest,
  exportDetails,
};
