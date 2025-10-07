const service = require("../services/laporanMutasiStokService");

const getProductList = async (req, res) => {
  try {
    const data = await service.getProductList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getMutationDetails = async (req, res) => {
  try {
    const data = await service.getMutationDetails(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getGudangOptions = async (req, res) => {
  try {
    const data = await service.getGudangOptions(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getProductList,
  getMutationDetails,
  getGudangOptions,
};
