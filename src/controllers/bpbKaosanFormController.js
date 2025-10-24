const service = require("../services/bpbKaosanFormService");

const getDataFromPO = async (req, res) => {
  try {
    const data = await service.getDataFromPO(req.params.nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
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
const getPoReferensi = async (req, res) => {
  try {
    const data = await service.getPoReferensi();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getPrintData(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

module.exports = {
  getDataFromPO,
  getDataForEdit,
  saveData,
  getPoReferensi,
  getPrintData,
};
