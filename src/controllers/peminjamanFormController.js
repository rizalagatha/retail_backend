const service = require("../services/peminjamanFormService");

const lookupProductByBarcode = async (req, res) => {
  try {
    const { barcode, cabang } = req.query;
    const result = await service.lookupProductByBarcode(barcode, cabang);
    res.json(result);
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

const lookupProducts = async (req, res) => {
  try {
    // req.query akan berisi { term, gudang, category, page, itemsPerPage }
    const result = await service.lookupProducts(req.query);
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
    console.error("Error Get Print Data PK:", error);
    res.status(404).json({ message: error.message });
  }
};

module.exports = {
  lookupProductByBarcode,
  saveData,
  lookupProducts,
  getPrintData,
};
