const service = require("../services/mutasiAntarGudangFormService");

const getGudangOptions = async (req, res) => {
  try {
    const data = await service.getGudangOptions();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getProductByBarcode = async (req, res) => {
  try {
    const { barcode, cabang } = req.query;
    if (!barcode || !cabang)
      return res
        .status(400)
        .json({ message: "Barcode dan Cabang diperlukan." });
    const data = await service.getProductByBarcode(barcode, cabang);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getDataForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getDataForEdit(nomor, req.user);
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
    const data = await service.getPrintData(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

module.exports = {
  getGudangOptions,
  getProductByBarcode,
  getDataForEdit,
  saveData,
  getPrintData,
};
