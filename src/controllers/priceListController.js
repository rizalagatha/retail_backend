const service = require("../services/priceListService");

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
    const data = await service.getDetails(req.params.kode);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updatePrices = async (req, res) => {
  try {
    const result = await service.updatePrices(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getList,
  getDetails,
  updatePrices,
};
