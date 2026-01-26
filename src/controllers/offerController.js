const offerService = require("../services/offerService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getOffers = async (req, res) => {
  try {
    const { startDate, endDate, cabang } = req.query;
    if (!startDate || !endDate || !cabang) {
      return res
        .status(400)
        .json({ message: "Parameter tanggal dan cabang diperlukan." });
    }

    const offers = await offerService.getOffers(startDate, endDate, cabang);
    res.json(offers);
  } catch (error) {
    console.error("❌ Controller Error:", error.sqlMessage || error.message);
    res.status(500).json({
      message: "Terjadi kesalahan di server.",
      error: error.sqlMessage || error.message,
    });
  }
};

const getOfferDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const details = await offerService.getOfferDetails(nomor);
    res.json(details);
  } catch (error) {
    console.error(
      `Error fetching details for offer ${req.params.nomor}:`,
      error,
    );
    res.status(500).json({ message: "Terjadi kesalahan di server." });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await offerService.getDataForPrinting(nomor);
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

const getExportDetails = async (req, res) => {
  try {
    const { startDate, endDate, cabang } = req.query;
    if (!startDate || !endDate || !cabang) {
      return res
        .status(400)
        .json({ message: "Parameter tanggal dan cabang diperlukan." });
    }
    const details = await offerService.getExportDetails(
      startDate,
      endDate,
      cabang,
    );
    res.json(details);
  } catch (error) {
    console.error("Error in getExportDetails controller:", error);
    res.status(500).json({ message: "Terjadi kesalahan di server." });
  }
};

const getBranchOptions = async (req, res) => {
  try {
    const { userCabang } = req.query;
    if (!userCabang) {
      return res
        .status(400)
        .json({ message: "Parameter userCabang diperlukan." });
    }
    const branches = await offerService.getBranchOptions(userCabang);
    res.json(branches);
  } catch (error) {
    res.status(500).json({ message: "Terjadi kesalahan di server." });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const deleteOffer = async (req, res) => {
  try {
    const { nomor } = req.params;

    // 1. SNAPSHOT: Ambil data lama sebelum dihapus (Header + Detail)
    let oldData = null;
    try {
      // A. Ambil Header
      const [headerRows] = await pool.query(
        "SELECT * FROM tpenawaran_hdr WHERE pen_nomor = ?",
        [nomor],
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Ambil Detail (Gunakan pend_nomor)
        const [detailRows] = await pool.query(
          "SELECT * FROM tpenawaran_dtl WHERE pend_nomor = ? ORDER BY pend_nourut",
          [nomor],
        );

        // C. Gabungkan
        oldData = {
          ...header,
          items: detailRows,
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData delete offer:", e.message);
    }

    // 2. PROSES: Hapus data
    const result = await offerService.deleteOffer(nomor);

    // 3. AUDIT: Catat Log Delete
    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE", // Action
        "PENAWARAN", // Module
        nomor, // Target ID
        oldData, // Data Lama (Header + Items)
        null, // Data Baru (Null karena dihapus)
        `Menghapus Penawaran Customer: ${oldData.pen_cus_kode || "Unknown"}`,
      );
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const closeOffer = async (req, res) => {
  try {
    const { nomor, alasan } = req.body;
    if (!nomor || !alasan) {
      return res.status(400).json({ message: "Nomor dan alasan diperlukan." });
    }

    // Langsung proses tanpa snapshot dan tanpa logActivity
    const result = await offerService.closeOffer(nomor, alasan);

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getOffers,
  getOfferDetails,
  getPrintData,
  getExportDetails,
  getBranchOptions,
  deleteOffer,
  closeOffer,
};
