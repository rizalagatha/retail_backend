const service = require("../services/proformaService");

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
    const { nomor } = req.query;
    if (!nomor)
      return res.status(400).json({ message: "Parameter 'nomor' diperlukan." });
    const data = await service.getDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteProforma = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await service.deleteProforma(nomor, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const exportDetail = async (req, res) => {
  try {
    const data = await service.getExportDetails(req.query, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getBranchOptions = async (req, res) => {
  try {
    const data = await service.getBranchOptions(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getList,
  getDetails,
  deleteProforma,
  exportDetail,
  getBranchOptions,
};
