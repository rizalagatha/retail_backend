const soDtfTrialService = require("../services/soDtfTrialService");

const getList = async (req, res) => {
  try {
    const filters = req.query;
    const user = req.user;
    const rows = await soDtfTrialService.getSoDtfList(filters, user);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching SO DTF Trial List:", error);
    res.status(500).json({ message: "Gagal memuat data SO DTF Trial" });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const rows = await soDtfTrialService.getSoDtfDetails(nomor);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching SO DTF Trial Details:", error);
    res.status(500).json({ message: "Gagal memuat detail SO DTF Trial" });
  }
};

const closeSo = async (req, res) => {
  try {
    const { nomor, alasan, user } = req.body;
    if (!nomor)
      return res.status(400).json({ message: "Nomor SO DTF wajib diisi." });

    const result = await soDtfTrialService.closeSoDtf(nomor, alasan, user);
    res.json(result);
  } catch (error) {
    console.error("Error closing SO DTF Trial:", error);
    res
      .status(500)
      .json({ message: error.message || "Gagal menutup SO DTF Trial." });
  }
};

const remove = async (req, res) => {
  try {
    const { nomor } = req.params;
    const user = req.user;
    const result = await soDtfTrialService.remove(nomor, user);
    res.json(result);
  } catch (error) {
    console.error("Error deleting SO DTF Trial:", error);
    res
      .status(500)
      .json({ message: error.message || "Gagal menghapus SO DTF Trial." });
  }
};

const exportDetail = async (req, res) => {
  try {
    const payload = req.body; // { nomors: [...] }
    const result = await soDtfTrialService.exportDetail(payload);
    res.json(result);
  } catch (error) {
    console.error("Error exporting SO DTF Trial Detail:", error);
    res.status(500).json({ message: "Gagal mengekspor detail SO DTF Trial" });
  }
};

module.exports = {
  getList,
  getDetails,
  closeSo,
  remove,
  exportDetail,
};
