const service = require("../services/barangDcService");

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
    const data = await service.getDetails(req.params.kode, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const exportDetails = async (req, res) => {
  /* panggil service.getExportDetails */
};

const getTotalProducts = async (req, res) => {
  try {
    const result = await service.getTotalProducts();
    res.json(result); // Langsung kirim seluruh objek hasil
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getList,
  getDetails,
  exportDetails,
  getTotalProducts,
};
