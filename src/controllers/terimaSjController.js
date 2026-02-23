const terimaSjService = require("../services/terimaSjService");

const getCabangList = async (req, res) => {
  try {
    const data = await terimaSjService.getCabangList(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getList = async (req, res) => {
  try {
    const data = await terimaSjService.getList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await terimaSjService.getDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const { nomorSj, nomorTerima } = req.params;
    const result = await terimaSjService.remove(nomorSj, nomorTerima, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const exportDetails = async (req, res) => {
  try {
    const data = await terimaSjService.getExportDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const runAutoReceive = async (req, res) => {
  try {
    // Hanya izinkan KDC untuk memicu ini
    if (req.user.cabang !== "KDC") {
      return res
        .status(403)
        .json({
          message: "Hanya admin KDC yang dapat memicu eksekusi sistem.",
        });
    }
    await terimaSjService.autoReceiveSj();
    res.json({ message: "Proses eksekusi otomatis berhasil dijalankan." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getCabangList,
  getList,
  getDetails,
  remove,
  exportDetails,
  runAutoReceive,
};
