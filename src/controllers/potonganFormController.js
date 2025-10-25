const service = require("../services/potonganFormService");

const getInitialData = async (req, res) => {
  try {
    const data = await service.getInitialData(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getCustomerLookup = async (req, res) => {
  try {
    const data = await service.getCustomerLookup(req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getInvoiceLookup = async (req, res) => {
  try {
    const { customerKode, gudangKode } = req.query;
    const data = await service.getInvoiceLookup(customerKode, gudangKode);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDataForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDataForEdit(nomor);
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

module.exports = {
  getInitialData,
  getCustomerLookup,
  getInvoiceLookup,
  getDataForEdit,
  saveData,
};
