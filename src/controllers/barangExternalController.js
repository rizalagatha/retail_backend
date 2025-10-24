const service = require("../services/barangExternalService");

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
    const { nomor } = req.params;
    const data = await service.getDetails(nomor, req.user);
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
  exportDetails,
};
