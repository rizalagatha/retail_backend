const service = require("../services/pengajuanProduksiFormService");

const getSupplierDetails = async (req, res) => {
  try {
    const data = await service.getSupplierDetails(req.params.kode);
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
    // Ambil data JSON dan files
    const data = JSON.parse(req.body.data);
    const files = req.files || [];

    const result = await service.saveData(data, files, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const validateUkuran = async (req, res) => {
  try {
    const { ukuran } = req.params;
    await service.validateUkuran(ukuran);
    res.json({ isValid: true });
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
  getSupplierDetails,
  getDataForEdit,
  saveData,
  validateUkuran,
  getPrintData,
};
