const priceProposalService = require("../services/priceProposalService");
const auditService = require("../services/auditService"); // Import Audit
const pool = require("../config/database"); // Import Pool untuk Snapshot

const getAll = async (req, res) => {
  try {
    // Ambil filter dari query string
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      cabang: req.query.cabang,
      // Ubah string 'true'/'false' menjadi boolean
      belumApproval: req.query.belumApproval === "true",
    };

    if (!filters.startDate || !filters.endDate || !filters.cabang) {
      return res
        .status(400)
        .json({ message: "Parameter tanggal dan cabang diperlukan." });
    }

    const proposals = await priceProposalService.getPriceProposals(filters);
    res.json(proposals);
  } catch (error) {
    console.error("Error in getPriceProposals controller:", error);
    res.status(500).json({ message: "Terjadi kesalahan di server." });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const details = await priceProposalService.getProposalDetails(nomor);
    res.json(details);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

// [AUDIT TRAIL DITERAPKAN DI SINI]
const remove = async (req, res) => {
  try {
    const { nomor } = req.params;

    // 1. SNAPSHOT: Ambil data lama LENGKAP (Header + 4 Detail)
    let oldData = null;
    try {
      // A. Ambil Header
      const [headerRows] = await pool.query(
        "SELECT * FROM tpengajuanharga WHERE ph_nomor = ?",
        [nomor],
      );

      if (headerRows.length > 0) {
        const header = headerRows[0];

        // B. Ambil Detail Bordir
        const [bordirRows] = await pool.query(
          "SELECT * FROM tpengajuanharga_bordir WHERE phb_nomor = ?",
          [nomor],
        );

        // C. Ambil Detail DTF
        const [dtfRows] = await pool.query(
          "SELECT * FROM tpengajuanharga_dtf WHERE phd_nomor = ?",
          [nomor],
        );

        // D. Ambil Detail Size
        const [sizeRows] = await pool.query(
          "SELECT * FROM tpengajuanharga_size WHERE phs_nomor = ?",
          [nomor],
        );

        // E. Ambil Detail Tambahan
        const [tambahanRows] = await pool.query(
          "SELECT * FROM tpengajuanharga_tambahan WHERE pht_nomor = ?",
          [nomor],
        );

        // F. Gabungkan
        oldData = {
          ...header,
          bordir: bordirRows,
          dtf: dtfRows,
          sizes: sizeRows,
          tambahan: tambahanRows,
        };
      }
    } catch (e) {
      console.warn("Gagal snapshot oldData remove price proposal:", e.message);
    }

    // 2. PROSES: Jalankan service remove
    const result = await priceProposalService.deleteProposal(nomor);

    // 3. AUDIT: Catat Log
    if (oldData) {
      auditService.logActivity(
        req,
        "DELETE", // Action
        "PENGAJUAN_HARGA", // Module
        nomor, // Target ID
        oldData, // Data Lama (Header + All Details)
        null, // Data Baru (Null)
        `Menghapus Pengajuan Harga Customer: ${oldData.ph_kd_cus || "Unknown"}`,
      );
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getAll,
  getDetails,
  remove,
};
