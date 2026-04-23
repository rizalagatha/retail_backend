const service = require("../services/mutasiWorkshopFormService");

const getForEdit = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await service.getForEdit(nomor);
    res.json(result);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const save = async (req, res) => {
  try {
    const result = await service.save(req.body, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const lookupTujuanWorkshop = async (req, res) => {
  try {
    const result = await service.lookupTujuanWorkshop();
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getProductDetails = async (req, res) => {
  try {
    const { kode, ukuran, gudang } = req.query;
    const result = await service.getProductDetails(kode, ukuran, gudang);
    res.json(result);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const findByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    const { gudang } = req.query;
    const result = await service.findByBarcode(barcode, gudang);
    res.json(result);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const result = await service.getPrintData(nomor, req.user);
    res.json(result);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const lookupProducts = async (req, res) => {
  try {
    const { gudang } = req.query;
    const result = await service.lookupProductsForMutasiKirim(gudang);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getForEdit,
  save,
  lookupTujuanWorkshop,
  getProductDetails,
  findByBarcode,
  getPrintData,
  lookupProducts,
};
