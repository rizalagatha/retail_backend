const service = require("../services/kartuPiutangService");

const getCustomerReceivables = async (req, res) => {
  try {
    const data = await service.getCustomerReceivables(req.query, req.user);
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

const getInvoiceList = async (req, res) => {
  try {
    const { customerKode } = req.params;
    const { cabang } = req.query;
    const data = await service.getInvoiceList(customerKode, cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPaymentDetails = async (req, res) => {
  try {
    const { piutangHeaderNomor } = req.params;
    const data = await service.getPaymentDetails(piutangHeaderNomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getCustomerReceivables,
  getCabangOptions,
  getInvoiceList,
  getPaymentDetails,
};
