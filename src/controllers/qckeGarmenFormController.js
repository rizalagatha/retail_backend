const service = require("../services/qckeGarmenFormService");

const getGudangOptions = async (req, res) => {
  try {
    const data = await service.getGudangOptions();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
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

const getBarangLookup = async (req, res) => {
  try {
    const data = await service.getBarangLookup(req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
const getVarianBarang = async (req, res) => {
  try {
    const { kodeBarang } = req.query;
    if (!kodeBarang)
      return res.status(400).json({ message: "Kode Barang diperlukan." });
    const data = await service.getVarianBarang(kodeBarang, req.user.cabang);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
const getProductByBarcodeGrid1 = async (req, res) => {
  try {
    const { barcode } = req.query;
    if (!barcode)
      return res.status(400).json({ message: "Barcode diperlukan." });
    const data = await service.getProductByBarcodeGrid1(barcode);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};
const getProductByBarcodeGrid2 = async (req, res) => {
  try {
    const { barcode } = req.query;
    if (!barcode)
      return res.status(400).json({ message: "Barcode diperlukan." });
    const data = await service.getProductByBarcodeGrid2(barcode);
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
  getGudangOptions,
  getDataForEdit,
  saveData,
  getBarangLookup,
  getVarianBarang,
  getProductByBarcodeGrid1,
  getProductByBarcodeGrid2,
  getPrintData,
};
