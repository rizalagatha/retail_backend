const service = require("../services/barangExternalFormService");

const getInitialData = async (req, res) => {
  try {
    const data = await service.getInitialData();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
const getUkuranOptions = async (req, res) => {
  try {
    const data = await service.getUkuranOptions(req.params.kategori);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
const getDataForEdit = async (req, res) => {
  try {
    const data = await service.getDataForEdit(req.params.kode);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};
const saveData = async (req, res) => {
  try {
    const data = JSON.parse(req.body.data);
    const file = req.file; // Hanya 1 file (upload.single)
    const result = await service.saveData(data, file, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getNewBarcodeId = async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ message: "Tanggal diperlukan." });
    
    const newId = await service.getNewBarcodeId(date); // newId adalah number
    
    res.json({ newId }); // Response: { newId: 278 }
  } catch (error) {
    console.error('❌ Error in getNewBarcodeId controller:', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getInitialData,
  getUkuranOptions,
  getDataForEdit,
  saveData,
  getNewBarcodeId,
};
