const service = require("../services/terimaStbjService");

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
    // Ambil 'nomor' dari query parameter (?nomor=...)
    const { nomor } = req.query;
    if (!nomor) {
      return res.status(400).json({ message: "Parameter nomor diperlukan." });
    }
    const data = await service.getDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const cancelReceipt = async (req, res) => {
  try {
    // Ambil 'nomor' dari query parameter
    const { nomor } = req.query;
    if (!nomor)
      return res.status(400).json({ message: "Parameter nomor diperlukan." });

    const result = await service.cancelReceipt(nomor, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const cancelRejection = async (req, res) => {
  try {
    const { nomor } = req.query; // Ambil dari query
    if (!nomor)
      return res.status(400).json({ message: "Parameter nomor diperlukan." });

    const result = await service.cancelRejection(nomor, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const exportDetails = async (req, res) => {
  try {
    const data = await service.getExportDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getList,
  getDetails,
  cancelReceipt,
  cancelRejection,
  exportDetails,
};
