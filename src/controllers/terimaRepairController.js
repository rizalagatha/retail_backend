const service = require("../services/terimaRepairService");

const getList = async (req, res) => {
  try {
    const data = await service.getList(req.query);
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

const cancelReceipt = async (req, res) => {
  try {
    const result = await service.cancelReceipt(req.params.nomor);
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
  exportDetails,
};
