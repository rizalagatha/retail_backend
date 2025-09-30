const warehouseService = require("../services/warehouseService");

const searchWarehouses = async (req, res) => {
  try {
    // --- PERBAIKAN DI SINI ---
    // Langsung teruskan seluruh objek req.query ke service.
    // Service akan menangani nilai default dan parameter opsional seperti excludeBranch & onlyDc.
    const result = await warehouseService.searchWarehouses(req.query);
    res.json(result);
  } catch (error) {
    console.error("Error in searchWarehouses controller:", error);
    res
      .status(500)
      .json({ message: error.message || "Terjadi kesalahan di server." });
  }
};

// Fungsi ini tidak perlu diubah
const getBranchList = async (req, res) => {
  try {
    const { userCabang } = req.query;
    if (!userCabang) {
      return res
        .status(400)
        .json({ message: "Parameter userCabang diperlukan." });
    }
    const branches = await warehouseService.getBranchOptions(userCabang);
    res.json(branches);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Fungsi ini tidak perlu diubah
const getSoDtfBranchList = async (req, res) => {
  try {
    const { userCabang } = req.query;
    if (!userCabang) {
      return res
        .status(400)
        .json({ message: "Parameter userCabang diperlukan." });
    }
    const branches = await warehouseService.getSoDtfBranchOptions(userCabang);
    res.json(branches);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  searchWarehouses, // Ganti nama dari 'search'
  getBranchList,
  getSoDtfBranchList,
};
