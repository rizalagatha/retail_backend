const service = require("../services/prosesStokOpnameService");

const getList = async (req, res) => {
  try {
    const data = await service.getList(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const transferSop = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { pin } = req.body;
    const result = await service.transferSop(nomor, pin, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
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

const getDetails = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDetails(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const validatePin = async (req, res) => {
  try {
    const { code, pin } = req.body;
    const result = await service.validateTransferPin(code, pin);
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
  transferSop,
  getCabangOptions,
  getDetails,
  validatePin,
  exportDetails,
};
