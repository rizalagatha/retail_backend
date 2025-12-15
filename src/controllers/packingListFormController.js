const service = require("../services/packingListFormService");

const saveData = async (req, res) => {
  try {
    // Tambahkan user info ke payload jika perlu, atau kirim terpisah
    const result = await service.saveData(req.body, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.loadForEdit(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const loadItemsFromRequest = async (req, res) => {
  try {
    const { nomor } = req.query; // ?nomor=MINTA001
    const data = await service.loadItemsFromRequest(nomor);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const findByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    const data = await service.findByBarcode(barcode);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
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
  saveData,
  getById,
  loadItemsFromRequest,
  findByBarcode,
  getPrintData,
};
