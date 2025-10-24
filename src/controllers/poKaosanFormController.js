const service = require("../services/poKaosanFormService");

const getDataFromPengajuan = async (req, res) => {
  try {
    const data = await service.getDataFromPengajuan(req.params.nomor);
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
    // Data JSON sekarang ada di req.body.data
    const data = JSON.parse(req.body.data);
    // File ada di req.files
    const files = req.files || [];

    const result = await service.saveData(data, files, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getReferensiPengajuan = async (req, res) => {
  try {
    const data = await service.getReferensiPengajuan();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSupplierDetails = async (req, res) => {
  try {
    const data = await service.getSupplierDetails(req.params.kode);
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

const getProductByBarcode = async (req, res) => {
  try {
    const { barcode } = req.query;
    if (!barcode)
      return res.status(400).json({ message: "Barcode diperlukan." });
    const data = await service.getProductByBarcode(barcode);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

module.exports = {
  getDataFromPengajuan,
  getDataForEdit,
  saveData,
  getReferensiPengajuan,
  getSupplierDetails,
  getPrintData,
  getProductByBarcode,
};
