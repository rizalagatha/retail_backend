const { getExportHeaders } = require("../services/formSetoranKasirService");
const service = require("../services/refundService");

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
    const data = await service.getDetails(req.params.nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
const deleteRefund = async (req, res) => {
  try {
    const { nomor } = req.params;
    const { nomorPO, cabang } = req.body;
    const result = await service.deleteRefund(nomor, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
const exportHeaders = async (req, res) => {
  try {
    const data = await service.getExportHeaders(req.query, req.user);
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
const getCabangOptions = async (req, res) => {
  try {
    const data = await service.getCabangOptions(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getList,
  getDetails,
  deleteRefund,
  exportHeaders,
  exportDetails,
  getCabangOptions,
};
