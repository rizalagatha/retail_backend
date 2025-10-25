const service = require("../services/refundFormService");

const getInvoiceLookup = async (req, res) => {
  try {
    const data = await service.getInvoiceLookup(req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
const getDepositLookup = async (req, res) => {
  try {
    const data = await service.getDepositLookup(req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
const getDataForEdit = async (req, res) => {
  try {
    const data = await service.getDataForEdit(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};
const saveData = async (req, res) => {
  try {
    const result = await service.saveData(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getPrintData(nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

module.exports = {
  getInvoiceLookup,
  getDepositLookup,
  getDataForEdit,
  saveData,
  getPrintData,
};
