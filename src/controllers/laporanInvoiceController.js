const service = require("../services/laporanInvoiceService");

const getInvoiceMasterData = async (req, res) => {
  try {
    const data = await service.getInvoiceMasterData(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


const getDetailByLevel = async (req, res) => {
  try {
    const data = await service.getDetailCustomerByLevel(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getCabangOptions = async (req, res) => {
  try {
    const data = await service.getCabangOptions(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
    getInvoiceMasterData,
    getDetailByLevel,
    getCabangOptions,
};