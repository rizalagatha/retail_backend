const service = require("../services/proformaFormService");

const getDataFromSO = async (req, res) => {
  try {
    const { soNumber } = req.params;
    const { branchCode } = req.query;
    if (!soNumber || !branchCode) {
      return res
        .status(400)
        .json({ message: "Nomor SO dan kode cabang diperlukan." });
    }
    const data = await service.getDataFromSO(soNumber, branchCode);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getDataForEdit = async (req, res) => {
  try {
    const { id } = req.params;
    const data = await service.getDataForEdit(id);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const saveNew = async (req, res) => {
  try {
    const result = await service.saveData(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateExisting = async (req, res) => {
  try {
    const payload = {
      header: { ...req.body.header, nomor: req.params.id },
      items: req.body.items,
    };
    const result = await service.saveData(payload, req.user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const lookupSO = async (req, res) => {
  try {
    const result = await service.lookupSO(req.query);
    res.json(result);
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
  getDataFromSO,
  getDataForEdit,
  saveNew,
  updateExisting,
  lookupSO,
  getPrintData,
};
