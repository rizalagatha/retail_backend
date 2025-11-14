const service = require("../services/fskFormService");

const loadInitialData = async (req, res) => {
  try {
    const { tanggal } = req.query;
    const data = await service.loadInitialData(tanggal, req.user);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const loadForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.loadForEdit(nomor, req.user);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await service.saveData(req.body, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
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

const remove = async (req, res) => {
  try {
    const result = await service.remove(req.params.nomor, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  loadInitialData,
  loadForEdit,
  save,
  getPrintData,
  remove,
};
