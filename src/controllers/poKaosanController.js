const service = require("../services/poKaosanService");

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
const deletePO = async (req, res) => {
  try {
    const result = await service.deletePO(req.params.nomor, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
const toggleClosePO = async (req, res) => {
  try {
    const result = await service.toggleClosePO(req.params.nomor, req.user);
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
  deletePO,
  toggleClosePO,
  exportDetails,
};
